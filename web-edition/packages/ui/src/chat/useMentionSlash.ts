import { useState, useCallback, useMemo } from "react";

export interface SlashCommand {
  id: string;
  name: string;
  command: string;
  description: string;
  icon: string;
  promptTemplate: string;
}

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "summarize",
    name: "Tóm tắt",
    command: "/summarize",
    description: "Tóm tắt ngắn gọn nội dung ghi chú đang mở hoặc được chọn",
    icon: "📝",
    promptTemplate: "Hãy tóm tắt ngắn gọn và súc tích nội dung chính của ghi chú này thành các ý gạch đầu dòng rõ ràng.",
  },
  {
    id: "action-items",
    name: "Trích xuất công việc",
    command: "/action-items",
    description: "Bóc tách to-do list, checklist công việc cần thực hiện",
    icon: "✅",
    promptTemplate: "Hãy bóc tách toàn bộ các công việc cần làm (action items, checklist) từ ghi chú này kèm người phụ trách/thời hạn nếu có.",
  },
  {
    id: "brainstorm",
    name: "Mở rộng ý tưởng",
    command: "/brainstorm",
    description: "Tạo các góc nhìn mới, đề xuất sáng tạo từ chủ đề",
    icon: "💡",
    promptTemplate: "Hãy brainstorm và đưa ra ít nhất 5 ý tưởng sáng tạo, góc nhìn độc đáo liên quan đến chủ đề này.",
  },
  {
    id: "qa",
    name: "Hỏi đáp tài liệu",
    command: "/qa",
    description: "Chế độ hỏi đáp sâu dựa trên cơ sở tri thức vault",
    icon: "🔍",
    promptTemplate: "Dựa trên tài liệu này, hãy trả lời câu hỏi sau một cách chi tiết và chính xác:",
  },
  {
    id: "translate",
    name: "Dịch thuật",
    command: "/translate",
    description: "Dịch nhanh tài liệu sang tiếng Anh hoặc ngôn ngữ đích",
    icon: "🌐",
    promptTemplate: "Hãy dịch đoạn nội dung sau sang tiếng Anh tự nhiên, chuẩn văn phong học thuật/chuyên nghiệp:",
  },
  {
    id: "explain",
    name: "Giải thích dễ hiểu",
    command: "/explain",
    description: "Giải thích khái niệm phức tạp một cách trực quan, bình dân",
    icon: "🎓",
    promptTemplate: "Hãy giải thích khái niệm trong ghi chú này theo phương pháp Feynman: cực kỳ trực quan, dễ hiểu như đang giải thích cho người mới bắt đầu.",
  },
  {
    id: "mindmap",
    name: "Sơ đồ tư duy (Mindmap)",
    command: "/mindmap",
    description: "Chuyển nội dung thành sơ đồ tư duy dạng Mermaid",
    icon: "🗺️",
    promptTemplate: "Hãy trích xuất cấu trúc kiến thức của ghi chú này thành sơ đồ tư duy Mermaid (dùng cú pháp flowchart TD hoặc mindmap) có tính logic cao.",
  },
];

export type PopupMode = "mention" | "slash" | null;

export interface ParseTriggerResult {
  mode: PopupMode;
  query: string;
}

export function parseTriggerAtCursor(text: string, cursorPos: number): ParseTriggerResult {
  const textBefore = text.slice(0, cursorPos);

  // Check for Slash command at start of line or prompt: e.g. "/sum"
  const slashMatch = textBefore.match(/(?:^|\n)\/([a-zA-Z0-9_-]*)$/);
  if (slashMatch) {
    return {
      mode: "slash",
      query: slashMatch[1].toLowerCase(),
    };
  }

  // Check for @mention: e.g. "@my-note"
  const atMatch = textBefore.match(/(?:^|\s)@([^\s@]*)$/);
  if (atMatch) {
    return {
      mode: "mention",
      query: atMatch[1].toLowerCase(),
    };
  }

  return { mode: null, query: "" };
}

export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (!query) return commands;
  return commands.filter(
    (c) =>
      c.command.toLowerCase().includes(query) ||
      c.name.toLowerCase().includes(query) ||
      c.description.toLowerCase().includes(query)
  );
}

export function filterMentionNotes<TNote>(
  notes: TNote[],
  query: string,
  getName: (n: TNote) => string,
  getPath: (n: TNote) => string,
  limit = 8
): TNote[] {
  if (!query) return notes.slice(0, limit);
  return notes
    .filter(
      (n) =>
        getName(n).toLowerCase().includes(query) ||
        getPath(n).toLowerCase().includes(query)
    )
    .slice(0, limit);
}

export interface UseMentionSlashOptions<TNote> {
  notes: TNote[];
  getNotePath: (note: TNote) => string;
  getNoteName: (note: TNote) => string;
  slashCommands?: SlashCommand[];
}

export function useMentionSlash<TNote>({
  notes,
  getNotePath,
  getNoteName,
  slashCommands = DEFAULT_SLASH_COMMANDS,
}: UseMentionSlashOptions<TNote>) {
  const [mode, setMode] = useState<PopupMode>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleInputChange = useCallback(
    (text: string, cursorPos: number) => {
      const parsed = parseTriggerAtCursor(text, cursorPos);
      setMode(parsed.mode);
      setQuery(parsed.query);
      setSelectedIndex(0);
    },
    []
  );

  const filteredCommands = useMemo(() => {
    if (mode !== "slash") return [];
    return filterSlashCommands(slashCommands, query);
  }, [mode, query, slashCommands]);

  const filteredNotes = useMemo(() => {
    if (mode !== "mention") return [];
    return filterMentionNotes(notes, query, getNoteName, getNotePath);
  }, [mode, query, notes, getNoteName, getNotePath]);

  const activeCount = mode === "slash" ? filteredCommands.length : filteredNotes.length;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!mode || activeCount === 0) return false;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % activeCount);
        return true;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + activeCount) % activeCount);
        return true;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setMode(null);
        return true;
      }

      return false;
    },
    [mode, activeCount]
  );

  const close = useCallback(() => {
    setMode(null);
    setQuery("");
  }, []);

  return {
    mode,
    query,
    selectedIndex,
    setSelectedIndex,
    filteredCommands,
    filteredNotes,
    handleInputChange,
    handleKeyDown,
    close,
  };
}
