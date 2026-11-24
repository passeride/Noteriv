import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { PluginApi } from "@noteriv/plugin-api";
import { audioMarkdown, formatDuration, generateRecordingFilename, saveErrorMessage } from "./recording";

export interface RecorderLabels {
  title: string;
  close: string;
  idle: string;
  requesting: string;
  recording: string;
  recorded: string;
  saving: string;
  start: string;
  stop: string;
  discard: string;
  save: string;
  denied: string;
  noMic: (msg: string) => string;
  saveFailed: string;
  savedNoNote: (target: string) => string;
}

type RecorderState = "idle" | "requesting" | "recording" | "recorded" | "saving";

/**
 * Microphone recorder (styles: `.ar-*` in the shared app.css). The recording is stored with `vault.saveAttachment`
 * (web: attachment storage; desktop: `attachments/` in the vault as a real binary file) and `![Audio](…)` goes in at
 * the cursor of the open note.
 */
export function AudioRecorder({ api, labels }: { api: PluginApi; labels: RecorderLabels }) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const filenameRef = useRef("");
  const audioUrlRef = useRef<string | null>(null);
  audioUrlRef.current = audioUrl;

  // Stop everything when the view closes (Escape, backdrop, plugin turned off…).
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close().catch(() => {});
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    []
  );

  const cssVar = (el: HTMLElement, name: string, fallback: string) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !analyser || !ctx) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      const { width, height } = canvas;
      ctx.fillStyle = cssVar(canvas, "--bg-surface", "#313244");
      ctx.fillRect(0, 0, width, height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = cssVar(canvas, "--accent", "#89b4fa");
      ctx.beginPath();
      const slice = width / data.length;
      data.forEach((v, i) => {
        const y = ((v / 128) * height) / 2;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * slice, y);
      });
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    };
    draw();
  }, []);

  const drawFlatLine = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height } = canvas;
    ctx.fillStyle = cssVar(canvas, "--bg-surface", "#313244");
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = cssVar(canvas, "--text-muted", "#6c7086");
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    drawFlatLine();
  }, [drawFlatLine]);

  const startRecording = useCallback(async () => {
    setError(null);
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        blobRef.current = blob;
        setAudioUrl(URL.createObjectURL(blob));
        setState("recorded");
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close().catch(() => {});
      };
      recorder.start(250);

      setElapsed(0);
      const started = Date.now();
      timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 200);
      drawWaveform();
      setState("recording");
      filenameRef.current = generateRecordingFilename();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("Permission") || msg.includes("NotAllowed") ? labels.denied : labels.noMic(msg));
      setState("idle");
    }
  }, [drawWaveform, labels]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
  }, []);

  useEffect(() => {
    if (!audioUrl || state !== "recorded") return;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.addEventListener("loadedmetadata", () => setPlaybackDuration(audio.duration));
    audio.addEventListener("timeupdate", () => setPlaybackTime(audio.currentTime));
    audio.addEventListener("ended", () => {
      setIsPlaying(false);
      setPlaybackTime(0);
    });
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [audioUrl, state]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else void audio.play();
    setIsPlaying(!isPlaying);
  };

  const seek = (e: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = parseFloat(e.target.value);
    setPlaybackTime(audio.currentTime);
  };

  async function save() {
    if (!blobRef.current) return;
    setState("saving");
    setError(null);
    try {
      const target = await api.vault.saveAttachment(filenameRef.current || generateRecordingFilename(), blobRef.current);
      if (api.editor.getContent() !== null) api.editor.insertAtCursor(audioMarkdown(target));
      else api.ui.showNotice(labels.savedNoNote(target));
      api.workspace.closeView();
    } catch (err) {
      setError(saveErrorMessage(err, labels.saveFailed));
      setState("recorded");
    }
  }

  function discard() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    blobRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
    setPlaybackTime(0);
    setPlaybackDuration(0);
    setIsPlaying(false);
    setError(null);
    setState("idle");
    drawFlatLine();
  }

  return (
    <div className="ar-modal" data-audio-recorder={state}>
      <div className="ar-header">
        <span className="ar-title">{labels.title}</span>
        <button className="ar-close-btn" onClick={() => api.workspace.closeView()} aria-label={labels.close}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="ar-body">
        <canvas ref={canvasRef} className="ar-waveform" />
        <div className="ar-timer">{formatDuration(elapsed)}</div>
        <div className="ar-status">
          <span className={`ar-status-dot${state === "recording" ? " ar-status-dot-recording" : ""}`} />
          <span>{labels[state]}</span>
        </div>

        {(state === "idle" || state === "recording") && (
          <div className="ar-controls">
            <button
              className={`ar-record-btn${state === "recording" ? " ar-record-btn-active" : ""}`}
              onClick={() => void (state === "idle" ? startRecording() : stopRecording())}
              title={state === "recording" ? labels.stop : labels.start}
              aria-label={state === "recording" ? labels.stop : labels.start}
            >
              <span className="ar-record-inner" />
            </button>
          </div>
        )}

        {state === "recorded" && audioUrl && (
          <div className="ar-playback">
            <div className="ar-playback-controls">
              <button className="ar-play-btn" onClick={togglePlayback}>
                {isPlaying ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <rect x="3" y="2" width="3" height="10" rx="1" />
                    <rect x="8" y="2" width="3" height="10" rx="1" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <path d="M4 2L12 7L4 12V2Z" />
                  </svg>
                )}
              </button>
              <input type="range" className="ar-seek-bar" min={0} max={playbackDuration || 0} step={0.1} value={playbackTime} onChange={seek} />
              <span className="ar-playback-time">{formatDuration(playbackTime)}</span>
            </div>
          </div>
        )}

        {error && <div className="ar-error">{error}</div>}
      </div>

      {state === "recorded" && (
        <div className="ar-actions">
          <button className="ar-btn ar-btn-discard" onClick={discard}>
            {labels.discard}
          </button>
          <button className="ar-btn ar-btn-save" onClick={() => void save()}>
            {labels.save}
          </button>
        </div>
      )}
      {state === "saving" && (
        <div className="ar-actions">
          <button className="ar-btn ar-btn-save" disabled>
            {labels.saving}
          </button>
        </div>
      )}
    </div>
  );
}
