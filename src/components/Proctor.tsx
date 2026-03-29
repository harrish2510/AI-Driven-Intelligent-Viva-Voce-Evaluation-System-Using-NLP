import { useEffect, useRef, useState } from "react";

type ViolationDetails = Record<string, unknown>;

type ProctorProps = {
  experimentId?: string;
  active?: boolean;
  onViolation?: (eventType: string, details: ViolationDetails) => void;
};

/**
 * AI Proctor
 * - Face detection
 * - Multiple face detection
 * - Gaze deviation heuristics
 * - Noise detection
 * - Tab switch / blur / devtools shortcut detection
 *
 * Important:
 * No browser app can absolutely block every extension.
 * This component detects the most common suspicious behaviors and locks the exam session.
 */
export default function Proctor({ experimentId, active = true, onViolation }: ProctorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onViolationRef = useRef(onViolation);
  const mountedRef = useRef(false);

  const gazeHistoryRef = useRef<{ x: number; y: number }[]>([]);
  const noFaceStreakRef = useRef(0);
  const noiseStreakRef = useRef(0);
  const devtoolsStreakRef = useRef(0);

  const [status, setStatus] = useState("Initializing proctor...");
  const [faceCount, setFaceCount] = useState<number | null>(null);
  const [gazeWarnings, setGazeWarnings] = useState(0);
  const [noiseWarnings, setNoiseWarnings] = useState(0);
  const [hasLandmarks, setHasLandmarks] = useState(false);
  const [lastViolation, setLastViolation] = useState<string>("");

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    if (!active) return;

    mountedRef.current = true;
    let detectionInterval: number | null = null;
    let devtoolsInterval: number | null = null;
    let analyser: AnalyserNode | null = null;
    let audioCtx: AudioContext | null = null;
    let localStream: MediaStream | null = null;
    let faceapiLib: any = null;

    const SERVICE_API = "/api/proctor-event";

    const postProctorEvent = async (eventType: string, details: ViolationDetails = {}) => {
      try {
        setLastViolation(eventType);
        await fetch(SERVICE_API, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            experiment_id: experimentId || null,
            event_type: eventType,
            details,
          }),
        });
      } catch (e) {
        console.warn("proctor event log failed", e);
      }
    };

    const reportViolation = async (
      eventType: string,
      details: ViolationDetails = {},
      message?: string
    ) => {
      if (!mountedRef.current) return;
      setLastViolation(eventType);
      if (message) setStatus(message);
      await postProctorEvent(eventType, details);
      onViolationRef.current?.(eventType, details);
    };

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);

    const computeSpread = (points: { x: number; y: number }[]) => {
      if (points.length < 2) return 0;
      const meanX = points.reduce((s, p) => s + p.x, 0) / points.length;
      const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
      return points.reduce(
        (s, p) => s + (p.x - meanX) * (p.x - meanX) + (p.y - meanY) * (p.y - meanY),
        0
      );
    };

    const isDevtoolsShortcut = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      return (
        key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(key)) ||
        (e.metaKey && e.altKey && ["I", "J", "C"].includes(key))
      );
    };

    const init = async () => {
      try {
        faceapiLib = await import("face-api.js");

        await faceapiLib.nets.tinyFaceDetector.loadFromUri("/models");
        let landmarksLoaded = false;
        try {
          await faceapiLib.nets.faceLandmark68Net.loadFromUri("/models");
          landmarksLoaded = true;
        } catch (err) {
          console.warn("face landmarks model not available; gaze checks disabled.");
        }
        setHasLandmarks(landmarksLoaded);

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream = stream;
        streamRef.current = stream;

        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        setStatus("Proctor active — keep your face centered.");
        const faceOptions = new faceapiLib.TinyFaceDetectorOptions({
          inputSize: 224,
          scoreThreshold: 0.4,
        });

        try {
          audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const source = audioCtx.createMediaStreamSource(stream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
        } catch (e) {
          console.warn("Audio analyser unavailable:", e);
        }

        const checkDevtoolsByWindowSize = async () => {
          const widthGap = Math.abs(window.outerWidth - window.innerWidth);
          const heightGap = Math.abs(window.outerHeight - window.innerHeight);
          const suspicious =
            widthGap > 180 || heightGap > 180 || window.outerWidth === 0 || window.outerHeight === 0;

          if (suspicious) {
            devtoolsStreakRef.current += 1;
          } else {
            devtoolsStreakRef.current = 0;
          }

          if (devtoolsStreakRef.current >= 2) {
            await reportViolation(
              "devtools_detected",
              { widthGap, heightGap },
              "Developer tools detected — exam locked."
            );
          }
        };

        detectionInterval = window.setInterval(async () => {
          if (!mountedRef.current || !videoRef.current) return;

          try {
            const detections = await faceapiLib.detectAllFaces(videoRef.current, faceOptions);
            if (!mountedRef.current) return;

            setFaceCount(detections.length);

            if (detections.length === 0) {
              noFaceStreakRef.current += 1;
              setStatus("No face detected — keep yourself in frame.");
              if (noFaceStreakRef.current >= 3) {
                await reportViolation("no_face", { streak: noFaceStreakRef.current }, "Face missing — exam locked.");
              }
            } else if (detections.length === 1) {
              noFaceStreakRef.current = 0;
              setStatus("One face detected — OK.");
            } else {
              noFaceStreakRef.current = 0;
              await reportViolation(
                "multiple_faces",
                { count: detections.length },
                "Multiple faces detected — exam locked."
              );
            }

            if (landmarksLoaded && detections.length === 1) {
              try {
                const res = await faceapiLib.detectSingleFace(videoRef.current, faceOptions).withFaceLandmarks();
                if (res && res.landmarks) {
                  const leftEye = res.landmarks.getLeftEye();
                  const rightEye = res.landmarks.getRightEye();
                  const centroid = {
                    x: (avg(leftEye.map((p: any) => p.x)) + avg(rightEye.map((p: any) => p.x))) / 2,
                    y: (avg(leftEye.map((p: any) => p.y)) + avg(rightEye.map((p: any) => p.y))) / 2,
                  };

                  gazeHistoryRef.current.push(centroid);
                  if (gazeHistoryRef.current.length > 8) gazeHistoryRef.current.shift();

                  const spread = computeSpread(gazeHistoryRef.current);
                  if (spread > 1200) {
                    setGazeWarnings((n) => n + 1);
                    await postProctorEvent("gaze_away", {
                      spread,
                      recent: gazeHistoryRef.current.slice(-4),
                    });

                    if (gazeWarnings + 1 >= 3) {
                      await reportViolation(
                        "gaze_away",
                        { spread, recent: gazeHistoryRef.current.slice(-4) },
                        "Gaze deviation detected — exam locked."
                      );
                    } else {
                      setStatus("Keep your eyes on the screen.");
                    }
                  }
                }
              } catch (err) {
                console.warn("landmark/gaze check failed", err);
              }
            }

            if (analyser) {
              const arr = new Uint8Array(analyser.fftSize);
              analyser.getByteTimeDomainData(arr);
              let sum = 0;
              for (let i = 0; i < arr.length; i++) {
                const v = (arr[i] - 128) / 128;
                sum += v * v;
              }
              const rms = Math.sqrt(sum / arr.length);

              if (rms > 0.2) {
                noiseStreakRef.current += 1;
                setNoiseWarnings(noiseStreakRef.current);
                await postProctorEvent("noise_alert", { rms });

                if (noiseStreakRef.current >= 5) {
                  await reportViolation(
                    "noise_alert",
                    { rms },
                    "Excessive noise detected — exam locked."
                  );
                } else {
                  setStatus("Noise detected — keep the environment quiet.");
                }
              } else {
                noiseStreakRef.current = 0;
              }
            }

            await checkDevtoolsByWindowSize();
          } catch (err) {
            console.warn("detection loop error", err);
          }
        }, 900);

        const onVisibility = async () => {
          if (document.hidden) {
            await reportViolation(
              "tab_switch",
              { hidden: true, timestamp: Date.now() },
              "Tab switch detected — exam locked."
            );
          }
        };

        const onBlur = async () => {
          if (!document.hidden && !document.hasFocus()) {
            await reportViolation(
              "window_blur",
              { timestamp: Date.now() },
              "Window focus lost — exam locked."
            );
          }
        };

        const onKeyDown = async (e: KeyboardEvent) => {
          if (isDevtoolsShortcut(e)) {
            e.preventDefault();
            e.stopPropagation();
            await reportViolation(
              "devtools_shortcut",
              {
                key: e.key,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                altKey: e.altKey,
              },
              "Developer tools shortcut detected — exam locked."
            );
          }
        };

        const onContextMenu = (e: MouseEvent) => {
          e.preventDefault();
          postProctorEvent("context_menu_blocked", { timestamp: Date.now() });
          setStatus("Right-click is blocked during the exam.");
        };

        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("blur", onBlur);
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("contextmenu", onContextMenu);

        devtoolsInterval = window.setInterval(checkDevtoolsByWindowSize, 1500);

        return () => {
          document.removeEventListener("visibilitychange", onVisibility);
          window.removeEventListener("blur", onBlur);
          window.removeEventListener("keydown", onKeyDown, true);
          window.removeEventListener("contextmenu", onContextMenu);
        };
      } catch (err: any) {
        console.error(err);
        setStatus("Proctor initialization failed: " + (err?.message || err));
      }
    };

    let removeListeners: (() => void) | undefined;
    init().then((cleanup) => {
      removeListeners = cleanup;
    });

    return () => {
      mountedRef.current = false;
      if (detectionInterval) window.clearInterval(detectionInterval);
      if (devtoolsInterval) window.clearInterval(devtoolsInterval);
      removeListeners?.();

      if (audioCtx) {
        try {
          audioCtx.close();
        } catch {}
      }

      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [active, experimentId, gazeWarnings, onViolation]);

  if (!active) return null;

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-slate-100 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
            AI Proctor
          </div>
          <div className="mt-1 text-lg font-semibold text-white">{status}</div>
          <div className="mt-1 text-xs text-slate-300">
            Suspicious activity is logged automatically. Switching tabs or opening developer tools will lock the exam.
          </div>
        </div>
        <div className="rounded-2xl bg-white/5 px-3 py-2 text-right text-xs text-slate-300">
          <div>Last event</div>
          <div className="font-semibold text-white">{lastViolation || "—"}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[320px_1fr]">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          <video ref={videoRef} width={320} height={240} className="h-auto w-full" autoPlay muted playsInline />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Face count</div>
            <div className="mt-1 text-2xl font-bold text-white">{faceCount === null ? "—" : faceCount}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Gaze warnings</div>
            <div className="mt-1 text-2xl font-bold text-white">{gazeWarnings}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Noise warnings</div>
            <div className="mt-1 text-2xl font-bold text-white">{noiseWarnings}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Landmarks</div>
            <div className="mt-1 text-2xl font-bold text-white">
              {hasLandmarks ? "Active" : "Unavailable"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}