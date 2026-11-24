import type { FastifyInstance, FastifyRequest } from "fastify";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { verifyAccessToken } from "../lib/jwt.js";
import { isAdmin } from "../lib/registration.js";
import { recordUsage } from "../lib/usageTracker.js";

/**
 * The signed-in user, if the request carries a valid access cookie. These relay routes are also used by clients
 * without a session (a local sidecar), so a missing user means "do not record usage", never a 401.
 */
function optionalUser(request: FastifyRequest): { id: string; email: string } | null {
  const token = request.cookies?.["noteriv_access"];
  if (!token) return null;
  try {
    const payload = verifyAccessToken(token);
    return { id: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

const optionalUserId = (request: FastifyRequest): string | null => optionalUser(request)?.id ?? null;

/**
 * The Claude Code CLI runs on the owner's personal subscription, so with CLAUDE_CLI_ADMIN_ONLY=1 (the server) only
 * admins may use it. Unset (local sidecar, dev) = no restriction.
 */
async function claudeCliAllowed(request: FastifyRequest, prisma: PrismaClient): Promise<boolean> {
  if (process.env.CLAUDE_CLI_ADMIN_ONLY !== "1") return true;
  const user = optionalUser(request);
  if (!user) return false;
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true, email: true, emailVerifiedAt: true, lockedAt: true },
  });
  return !!row && row.lockedAt === null && isAdmin(row);
}

const asCount = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

export default async function aiRoutes(fastify: FastifyInstance) {
  /** Never throws: a failed write must not break a chat that already streamed. */
  async function record(userId: string | null, provider: string, model: string, tokensIn: number, tokensOut: number) {
    if (!userId) return;
    try {
      await recordUsage(fastify.prisma, { userId, provider, model, tokensIn, tokensOut });
    } catch (err) {
      fastify.log.error({ err, userId, provider }, "failed to record AI usage");
    }
  }

  fastify.post("/claude-stream", async (request, reply) => {
    if (!(await claudeCliAllowed(request, fastify.prisma))) return reply.code(403).send({ error: "forbidden" });
    const body = (request.body || {}) as any;
    const { messages = [], systemPrompt = "", model, reasoningEffort } = body;

    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    const userPrompt = lastUserMsg?.content || "Xin chào";

    const baseInstruction =
      systemPrompt ||
      "Bạn là trợ lý Noteriv AI thông minh cho sổ tay ghi chú Markdown (Vault). Bạn nắm toàn diện cấu trúc Vault thông qua thẻ <vault_overview> trong <context> (gồm tên vault, tổng số ghi chú, danh sách các thư mục, và toàn bộ file trong vault). Khi người dùng hỏi về số lượng file, danh sách thư mục, hoặc tìm ghi chú, hãy sử dụng thông tin trong <vault_overview> để trả lời chính xác, đầy đủ và thân thiện bằng tiếng Việt. Không trả lời rằng bạn thiếu công cụ đếm file vì toàn bộ danh sách đã có trong <vault_overview>.";

    const prompt = `[HƯỚNG DẪN HỆ THỐNG]:\n${baseInstruction}\n\n[CÂU HỎI NGƯỜI DÙNG]:\n${userPrompt}`;

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("Access-Control-Allow-Origin", "*");
    reply.raw.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (typeof (reply.raw as any).flushHeaders === "function") {
      (reply.raw as any).flushHeaders();
    }

    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (model && model !== "default") {
      args.push("--model", model);
    }
    if (reasoningEffort && reasoningEffort !== "none") {
      const effortMap: Record<string, string> = {
        low: "low",
        medium: "medium",
        high: "high",
        max: "max",
      };
      args.push("--effort", effortMap[reasoningEffort] || "medium");
    }

    // Spawn claude CLI with stdin piping to avoid Windows shell argument truncation
    const child = spawn(
      process.env.CLAUDE_BIN || (process.platform === "win32" ? "claude.exe" : "claude"),
      args,
      {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: process.platform === "win32" ? process.env.TEMP || "C:\\" : os.tmpdir(),
        shell: process.platform === "win32",
      }
    );

    // Pipe the full prompt safely via stdin
    child.stdin.write(prompt);
    child.stdin.end();

    const userId = optionalUserId(request);
    // The CLI's final "result" event carries the totals for the whole request (cache reads count as input).
    let tokensIn = 0;
    let tokensOut = 0;
    let lastDeliveredText = "";
    let buffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;

        try {
          const event = JSON.parse(trimmed);
          if (event.type === "assistant" && event.message?.content) {
            for (const part of event.message.content) {
              if (part.type === "text" && typeof part.text === "string") {
                const fullText = part.text;
                if (fullText.length > lastDeliveredText.length && fullText.startsWith(lastDeliveredText)) {
                  const delta = fullText.slice(lastDeliveredText.length);
                  lastDeliveredText = fullText;
                  reply.raw.write(`data: ${JSON.stringify({ type: "text_delta", text: delta })}\n\n`);
                } else if (fullText !== lastDeliveredText && fullText.length > 0) {
                  const delta = fullText.startsWith(lastDeliveredText)
                    ? fullText.slice(lastDeliveredText.length)
                    : fullText;
                  lastDeliveredText = fullText;
                  reply.raw.write(`data: ${JSON.stringify({ type: "text_delta", text: delta })}\n\n`);
                }
              }
            }
          } else if (event.type === "result" && event.result) {
            const u = event.usage;
            if (u) {
              tokensIn = asCount(u.input_tokens) + asCount(u.cache_creation_input_tokens) + asCount(u.cache_read_input_tokens);
              tokensOut = asCount(u.output_tokens);
            }
            if (typeof event.result === "string" && event.result.length > lastDeliveredText.length) {
              const delta = event.result.slice(lastDeliveredText.length);
              lastDeliveredText = event.result;
              reply.raw.write(`data: ${JSON.stringify({ type: "text_delta", text: delta })}\n\n`);
            }
          }
        } catch {
          // ignore partial JSON
        }
      }
    });

    child.on("close", async (code) => {
      // Before the stream ends, so the client's refresh right after "done" sees this request.
      await record(userId, "claude-sdk", model && model !== "default" ? String(model) : "default", tokensIn, tokensOut);
      if (code !== 0 && lastDeliveredText.length === 0) {
        reply.raw.write(
          `data: ${JSON.stringify({
            type: "error",
            message: `Claude Code exited with code ${code}`,
          })}\n\n`
        );
      } else {
        reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
      }
      reply.raw.end();
    });

    child.on("error", (err) => {
      reply.raw.write(
        `data: ${JSON.stringify({
          type: "error",
          message: `Failed to spawn Claude CLI: ${err.message}`,
        })}\n\n`
      );
      reply.raw.end();
    });
  });

  fastify.post("/antigravity-stream", async (request, reply) => {
    const body = (request.body || {}) as any;
    const { messages = [], systemPrompt = "", model, reasoningEffort } = body;

    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    const userPrompt = lastUserMsg?.content || "Xin chào";

    const baseInstruction =
      systemPrompt ||
      "Bạn là trợ lý Noteriv AI thông minh cho sổ tay ghi chú Markdown (Vault). Bạn nắm toàn diện cấu trúc Vault thông qua thẻ <vault_overview> trong <context> (gồm tên vault, tổng số ghi chú, danh sách các thư mục, và toàn bộ file trong vault). Khi người dùng hỏi về số lượng file, danh sách thư mục, hoặc tìm ghi chú, hãy sử dụng thông tin trong <vault_overview> để trả lời chính xác, đầy đủ và thân thiện bằng tiếng Việt. Không trả lời rằng bạn thiếu công cụ đếm file vì toàn bộ danh sách đã có trong <vault_overview>.";

    const prompt = `[HƯỚNG DẪN HỆ THỐNG]:\n${baseInstruction}\n\n[CÂU HỎI NGƯỜI DÙNG]:\n${userPrompt}`;

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("Access-Control-Allow-Origin", "*");
    reply.raw.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (typeof (reply.raw as any).flushHeaders === "function") {
      (reply.raw as any).flushHeaders();
    }

    const defaultAgyPath = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.EXE")
      : "agy.exe";
    const agyBin = fs.existsSync(defaultAgyPath) ? defaultAgyPath : "agy.exe";

    const validAgyModels = [
      "gemini-3.8-flash-high",
      "gemini-3.8-flash-medium",
      "gemini-3.8-flash-low",
      "gemini-4-argon-high",
      "gemini-4-argon-medium",
      "gemini-4-argon-low",
      "claude-sonnet-5-5-high",
      "claude-sonnet-5-5-medium",
      "claude-sonnet-5-5-low",
      "claude-opus-5-5-high",
      "claude-opus-5-5-medium",
      "claude-opus-5-5-low",
      "gpt-oss-120b-medium",
    ];

    const targetModel = model && validAgyModels.includes(model) ? model : "gemini-3.8-flash-high";
    const args = ["--input-format", "text", "--output-format", "stream-json", "--model", targetModel];

    if (reasoningEffort && reasoningEffort !== "none") {
      const effortMap: Record<string, string> = {
        low: "low",
        medium: "medium",
        high: "high",
        max: "max",
      };
      args.push("--effort", effortMap[reasoningEffort] || "medium");
    }

    const child = spawn(agyBin, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.env.TEMP || "C:\\",
      shell: process.platform === "win32",
    });

    // Pipe prompt safely via stdin to prevent Windows cmd.exe argument corruption
    child.stdin.write(prompt);
    child.stdin.end();

    let buffer = "";
    let stderrBuffer = "";
    let lastDeliveredText = "";
    let lastErrorMessage = "";
    const userId = optionalUserId(request);
    // The CLI reports usage both per step and in the final result. Counting each report would double count, so keep
    // one figure: the final result's if it came, else the largest step report (assumed cumulative, not a delta).
    let stepIn = 0;
    let stepOut = 0;
    let finalIn = 0;
    let finalOut = 0;

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;

        try {
          const event = JSON.parse(trimmed);
          if (event.event === "step_update" && event.step_update) {
            const update = event.step_update;
            if (update.text_delta) {
              lastDeliveredText += update.text_delta;
              reply.raw.write(`data: ${JSON.stringify({ type: "text_delta", text: update.text_delta })}\n\n`);
            }
            if (update.usage) {
              stepIn = Math.max(stepIn, asCount(update.usage.input_tokens));
              stepOut = Math.max(stepOut, asCount(update.usage.output_tokens));
              reply.raw.write(
                `data: ${JSON.stringify({
                  type: "usage",
                  inputTokens: update.usage.input_tokens || 0,
                  outputTokens: update.usage.output_tokens || 0,
                })}\n\n`
              );
            }
          } else if (event.event === "result" && event.result) {
            if (event.result.status === "ERROR") {
              lastErrorMessage = event.result.error || "Antigravity CLI execution error";
            }
            if (event.result.usage) {
              finalIn = asCount(event.result.usage.input_tokens);
              finalOut = asCount(event.result.usage.output_tokens);
              reply.raw.write(
                `data: ${JSON.stringify({
                  type: "usage",
                  inputTokens: event.result.usage.input_tokens || 0,
                  outputTokens: event.result.usage.output_tokens || 0,
                })}\n\n`
              );
            }
          }
        } catch {
          // ignore partial JSON
        }
      }
    });

    child.on("close", async (code) => {
      const hasFinal = finalIn > 0 || finalOut > 0;
      await record(userId, "antigravity-cli", targetModel, hasFinal ? finalIn : stepIn, hasFinal ? finalOut : stepOut);
      if (code !== 0 && lastDeliveredText.length === 0) {
        const errMsg = lastErrorMessage || stderrBuffer.trim() || `Antigravity CLI exited with code ${code}`;
        reply.raw.write(
          `data: ${JSON.stringify({
            type: "error",
            message: errMsg,
          })}\n\n`
        );
      } else {
        reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
      }
      reply.raw.end();
    });

    child.on("error", (err) => {
      reply.raw.write(
        `data: ${JSON.stringify({
          type: "error",
          message: `Failed to spawn Antigravity CLI: ${err.message}`,
        })}\n\n`
      );
      reply.raw.end();
    });
  });
}
