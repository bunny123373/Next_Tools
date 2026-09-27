import type { Tool } from "../types";

/**
 * Video tools.
 *
 * Every tool here is `processing: "local"`: the file is decoded, re-encoded and
 * handed back as a `Blob` inside the tab. The honest limitation — shared by all
 * ten — is that `MediaRecorder` encodes in real time, so each job takes about as
 * long as the clip it is producing. The copy says so rather than implying a
 * faster-than-realtime speed that the browser cannot deliver.
 */
export const VIDEO_TOOLS: readonly Tool[] = [
  {
    id: "video-compressor",
    name: "Video Compressor",
    slug: "compressor",
    category: "video",
    description:
      "Reduce video file size by lowering resolution, bitrate and frame rate. Re-encoded in your browser in real time, nothing is uploaded.",
    intro:
      "Shrink a video by picking a smaller resolution, a lower target bitrate or a reduced frame rate. The export runs in your browser and takes roughly as long as the clip itself, because that is how the browser's encoder works.",
    icon: "Clapperboard",
    keywords: ["shrink", "reduce size", "optimise", "smaller file", "bitrate", "recompress"],
    route: "/tools/video/compressor",
    processing: "local",
    status: "beta",
    popular: true,
    addedOn: "2026-01-08",
    actionLabel: "Compress",
    features: [
      "Target resolution from 10% to 100% of the original, with even-dimension rounding so encoders accept the result",
      "Real target bitrate control, with a live size estimate of bitrate × duration before you commit",
      "Frame-rate picker — 24, 25, 30, 50, 60 fps or keep the source rate",
      "Warns you when your settings would produce a file *larger* than the input, before you spend the recording time",
      "Output container driven by real MediaRecorder.isTypeSupported results, never a silent substitution",
      "Real progress: elapsed time, remaining time, and a Cancel button that aborts the recorder mid-pass",
    ],
    howItWorks: [
      "Your file is opened with a hidden <video> element and its real dimensions and duration are read from the container",
      "A canvas is sized to the target resolution and the video is played back frame by frame into it",
      "The canvas is captured with canvas.captureStream() and piped into a MediaRecorder alongside the source audio",
      "The recorded blob is handed to you as a download — nothing leaves the device",
    ],
    faq: [
      {
        question: "Why does compressing a 2-minute video take about 2 minutes?",
        answer:
          "The browser's MediaRecorder encodes as fast as the video plays, not faster. There is no shipped WebAssembly encoder here because that would mean downloading a 30 MB FFmpeg payload. If we ever add one, the export becomes faster than real time — the controls will not change.",
      },
      {
        question: "Will the result definitely be smaller?",
        answer:
          "No, and we tell you so. Re-encoding a file that is already heavily compressed, at the same resolution and bitrate, produces a slightly larger file. The tool shows the estimated output size next to the input size and warns before you start when the estimate is larger.",
      },
      {
        question: "Which formats can it export?",
        answer:
          "Whatever your browser's MediaRecorder supports: MP4 (H.264 + AAC) in recent Chrome and Edge, WebM (VP9 or VP8) in Chrome and Firefox, Ogg Theora in Firefox. The format list is built from isTypeSupported results, so a format you cannot use is marked as such rather than quietly swapped.",
      },
      {
        question: "Is the audio kept?",
        answer:
          "Yes. The source audio is rerouted through the Web Audio graph into the recorder, so the soundtrack is re-encoded along with the video. If the browser refuses to hand over an audio track, the result is exported silent and we say so.",
      },
    ],
    related: ["video-converter", "video-resizer", "video-trimmer"],
  },
  {
    id: "video-converter",
    name: "Video Converter",
    slug: "converter",
    category: "video",
    description:
      "Convert video between MP4 and WebM using the codecs your browser actually supports, with resolution and frame-rate control.",
    intro:
      "Convert between the containers and codecs your browser can really encode. MP4 support depends on the browser — Safari has no MediaRecorder video encoder at all, and older Chrome cannot record MP4.",
    icon: "Video",
    keywords: ["convert", "mp4 to webm", "webm to mp4", "change format", "codec", "transcode"],
    route: "/tools/video/converter",
    processing: "local",
    status: "beta",
    popular: true,
    addedOn: "2026-01-08",
    actionLabel: "Convert",
    features: [
      "A format picker built from live MediaRecorder.isTypeSupported results, with what your browser can actually do spelled out per format",
      "MP4/H.264, WebM/VP9, WebM/VP8 and Ogg/Theora, each labelled with its codec and audio pairing",
      "Resolution scale and frame-rate control alongside the container choice",
      "If your first choice is unavailable we name the substitute out loud instead of swapping it silently",
      "Keeps the source audio, re-encoded by the browser",
      "Real-time export with elapsed and remaining time, plus a working Cancel button",
    ],
    howItWorks: [
      "Codec support is probed once per page load with isTypeSupported — nothing is guessed from the user agent",
      "Your chosen format is validated; if it is unsupported you are told which format will be used instead and why",
      "The video is replayed into a canvas at the chosen size and captured into a MediaRecorder",
      "The finished blob downloads with the extension that matches the container you actually got",
    ],
    faq: [
      {
        question: "Why is MP4 greyed out in Safari?",
        answer:
          "Safari has never shipped a MediaRecorder video encoder. No amount of configuration will change that, so the option is marked unavailable rather than failing when you press Convert. Export WebM there, or re-encode on the desktop and bring the MP4 back.",
      },
      {
        question: "Can I convert WebM to MP4?",
        answer:
          "Yes, in Chrome 126 and later and in Edge, which added MP4 recording. Firefox cannot record MP4, so there it will offer a WebM alternative and tell you which one it picked.",
      },
      {
        question: "Will conversion reduce quality?",
        answer:
          "Always somewhat. The file is decoded to raw frames and re-encoded, which loses whatever the previous encoder threw away. Convert between containers at the same resolution and a generous bitrate when quality matters more than size.",
      },
      {
        question: "How long does it take?",
        answer:
      "As long as the video. MediaRecorder encodes in real time. A 10-minute clip is a 10-minute job — the progress bar and the remaining-time readout reflect that honestly.",
      },
    ],
    related: ["video-compressor", "video-to-gif", "video-to-audio"],
  },
  {
    id: "video-trimmer",
    name: "Video Trimmer",
    slug: "trimmer",
    category: "video",
    description:
      "Cut a video to exact in and out points on a thumbnail timeline, preview the segment, then export just that part.",
    intro:
      "Drag the handles on a real thumbnail strip to set your in and out points, scrub the selection with numeric timecodes, preview it, and export only the segment you kept.",
    icon: "Scissors",
    keywords: ["cut", "trim", "clip", "split", "crop time", "remove parts"],
    route: "/tools/video/trimmer",
    processing: "local",
    status: "beta",
    popular: true,
    addedOn: "2026-01-15",
    actionLabel: "Export segment",
    features: [
      "Thumbnail strip generated by seeking the real file and painting actual decoded frames",
      "In and out handles draggable with a mouse, a finger, or the arrow keys",
      "Numeric timecode fields for frame-accurate entry, plus a live selection duration",
      "Preview player that loops only the selected range",
      "Keep-audio toggle, and an honest note that the cut lands on the nearest frame boundary",
      "Real-time export with a Cancel button that stops the recorder and frees the file",
    ],
    howItWorks: [
      "Thumbnails are captured by seeking the hidden video element and drawing each frame to a canvas",
      "Your in and out points are stored in seconds and clamped so out is always after in",
      "On export the video seeks to the in point, plays to the out point, and is captured into a MediaRecorder",
      "The recorded segment downloads as a new file; the original is untouched",
    ],
    faq: [
      {
        question: "Is the cut frame-accurate?",
        answer:
          "To the nearest frame boundary of the source. The browser cannot present a frame that does not exist, so the cut lands on the first frame at or after your out point. At 30 fps that is at most 33 ms of extra material.",
      },
      {
        question: "Does the exported segment keep the audio?",
        answer:
          "Yes by default. The source soundtrack is re-encoded along with the video. Turn off 'Keep audio' for a silent export, which is also slightly faster.",
      },
      {
        question: "Why are some thumbnails missing?",
        answer:
          "The browser could not decode a frame at that timestamp — usually a sparse keyframe in a long GOP. We skip it rather than repeating a neighbour, so the strip shows you the real decodable range.",
      },
      {
        question: "Can I undo a trim?",
        answer:
          "Nothing is destructive. Your original file is never modified, and resetting or choosing a new file starts from the untouched source again.",
      },
    ],
    related: ["video-cropper", "video-compressor", "video-frames"],
  },
  {
    id: "video-cropper",
    name: "Video Cropper",
    slug: "cropper",
    category: "video",
    description:
      "Crop video to 16:9, 9:16, 1:1, 4:3, 2.39:1 or a free rectangle dragged over a live frame, then export the cropped video.",
    intro:
      "Pick an aspect ratio or drag your own crop rectangle over a live frame, nudge the handles, and export the cropped result with its audio intact.",
    icon: "Crop",
    keywords: ["crop", "aspect ratio", "vertical", "square", "cinemascope", "trim edges"],
    route: "/tools/video/cropper",
    processing: "local",
    status: "beta",
    addedOn: "2026-01-15",
    actionLabel: "Export crop",
    features: [
      "Aspect presets for 16:9, 9:16, 1:1, 4:3, 2.39:1, plus a free-form mode",
      "Crop rectangle dragged and resized directly on a real frame from your video",
      "The preview is a live <video> element, not a still, so you can check motion before exporting",
      "Output dimensions reported in pixels, rounded to even numbers for encoder compatibility",
      "Handles respond to arrow keys for precise nudging, and to touch via pointer events",
      "Real-time export with a Cancel button",
    ],
    howItWorks: [
      "Your file is loaded into a video element and the first frame is shown as the cropping surface",
      "Choosing a preset fits the largest centred rectangle of that ratio inside the frame; free mode lets you drag it yourself",
      "On export every frame is drawn to a canvas cropped to the rectangle, then captured into a MediaRecorder",
      "The audio track is carried across unchanged apart from re-encoding",
    ],
    faq: [
      {
        question: "Can I make a vertical video for social media?",
        answer:
          "Choose 9:16 and the crop is the largest upright rectangle that fits. If you want the original rotated to fill the frame rather than cropped, convert it elsewhere first — this tool never rotates.",
      },
      {
        question: "Why are my output dimensions rounded to even numbers?",
        answer:
          "H.264 stores macroblocks of 16×16 and 4:2:0 chroma subsampling halves the effective width and height. An odd dimension makes the encoder either fail or round behind your back, so we round up to the next even number and tell you the real size.",
      },
      {
        question: "Does cropping change the frame rate?",
        answer:
          "No. The frame rate you see in the source is the frame rate of the export; the recorder samples the canvas at that rate while the video plays.",
      },
      {
        question: "How long does the export take?",
        answer:
          "About as long as the clip, because the browser encodes in real time. The progress readout and Cancel button are live throughout.",
      },
    ],
    related: ["video-resizer", "video-trimmer", "video-watermark"],
  },
  {
    id: "video-resizer",
    name: "Video Resizer",
    slug: "resizer",
    category: "video",
    description:
      "Resize video by width or height with the aspect ratio locked, using preset scale steps or your own dimensions.",
    intro:
      "Set a target width or height, keep the aspect ratio locked, and export at the new size. Preset scale steps cover the common cases; the numeric fields cover the rest.",
    icon: "Ruler",
    keywords: ["resize", "scale", "shrink", "smaller", "dimensions", "hd", "4k"],
    route: "/tools/video/resizer",
    processing: "local",
    status: "beta",
    addedOn: "2026-01-15",
    actionLabel: "Resize",
    features: [
      "Width and height inputs with an aspect-ratio lock you can release when you need to force a shape",
      "Preset scale steps — 25%, 50%, 75%, 100%, 150%, 200% — that fill both fields for you",
      "Common target sizes such as 1080p, 720p and 480p alongside a free-form width",
      "Output dimensions clamped so you cannot ask for zero or negative pixels",
      "Rounded up to even numbers because H.264 cannot represent odd dimensions",
      "Real-time export with elapsed/remaining time and a Cancel button",
    ],
    howItWorks: [
      "The source dimensions are read from the decoded video, not from the filename",
      "Your width or height is applied and the other dimension derived from the source aspect ratio",
      "Each frame is scaled into a canvas of the target size while the video plays",
      "The canvas stream is recorded and the resulting file downloads",
    ],
    faq: [
      {
        question: "Will upscaling a video improve it?",
        answer:
          "No. Scaling up only adds pixels the original never had, and re-encoding adds a little more loss. Use this to go down, or to match a platform's maximum dimensions.",
      },
      {
        question: "What is the maximum output size?",
        answer:
          "Whatever your device can encode in real time. 4K is usually fine on a recent laptop; an 8K export on a low-powered machine will drop frames because the encoder cannot keep up, which the skipped-frame counter will show you.",
      },
      {
        question: "Does it change the aspect ratio?",
        answer:
          "Not unless you unlock the aspect ratio and type both numbers yourself. The lock is on by default precisely because a forced aspect ratio squashes faces.",
      },
    ],
    related: ["video-cropper", "video-compressor", "video-watermark"],
  },
  {
    id: "video-to-gif",
    name: "Video to GIF",
    slug: "to-gif",
    category: "video",
    description:
      "Turn a video into a looping GIF with real frame counts, adjustable frame rate, width, loop count and palette quality.",
    intro:
      "Choose a range, pick a frame rate and width, and watch the actual frame count climb as the GIF is built. Frame capture happens live, so the percentage you see is frames captured over frames expected — never a guess.",
    icon: "FileImage",
    keywords: ["gif", "convert to gif", "animated gif", "loop", "meme", "reaction"],
    route: "/tools/video/to-gif",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-22",
    actionLabel: "Create GIF",
    features: [
      "Start and end points on a thumbnail strip, with a live selection duration",
      "Frame rate from 5 to 30 fps, output width from 120 to 800 px",
      "Loop control: play once, loop forever, or a specific number of repeats",
      "Colour quality control: palette size and a 565/444 trade-off between fidelity and file size",
      "A real frame count, an estimated size before you start, and an honest warning when the 800-frame cap is hit",
      "Frames the browser cannot produce are counted and reported rather than silently duplicated",
    ],
    howItWorks: [
      "The video plays from your in point while a single global palette is derived from sampled frames",
      "At your chosen frame rate each newly composited frame is read back from a canvas and quantised to the shared palette",
      "gifenc writes the indexed frames into one animated GIF stream with your loop count and per-frame delay",
      "The finished GIF downloads as image/gif",
    ],
    faq: [
      {
        question: "Why did I get fewer frames than I asked for?",
        answer:
          "Two honest reasons. The browser can only hand over frames it actually decoded, and a high requested rate on a slow machine will not reach it. The result always reports the real captured count and the number of frames the browser skipped.",
      },
      {
        question: "What is the 800-frame limit?",
        answer:
          "An animated GIF of 800 large frames can be tens of megabytes and is painful to share. When the cap is hit, the GIF stops at 800 frames and the tool tells you plainly rather than silently shortening it.",
      },
      {
        question: "Why do my colours look banded?",
        answer:
          "GIF has 256 colours per palette, so photographic gradients will band. We build one global palette from sampled frames to stop colours shifting between frames, and offer a 64-colour 'small' mode when size matters more than fidelity.",
      },
      {
        question: "Can I make a GIF from a specific moment only?",
        answer:
          "Yes. Set the start and end handles on the thumbnail strip. Keeping the range short is the single biggest factor in keeping the file small.",
      },
    ],
    related: ["video-trimmer", "video-compressor", "video-frames"],
  },
  {
    id: "video-speed",
    name: "Change Video Speed",
    slug: "speed",
    category: "video",
    description:
      "Speed a video up or slow it down from 0.25× to 4×, with optional pitch compensation on the audio track.",
    intro:
      "Speed up a clip or slow it down, and decide what should happen to the pitch. Slowing down or speeding up still records in real time — a 2× speed-up finishes twice as fast as the clip, a 0.5× slow-down takes twice as long.",
    icon: "Gauge",
    keywords: ["speed", "faster", "slow motion", "time lapse", "accelerate", "playback rate"],
    route: "/tools/video/speed",
    processing: "local",
    status: "beta",
    addedOn: "2026-02-04",
    actionLabel: "Change speed",
    features: [
      "0.25×, 0.5×, 1×, 1.5×, 2× and 4× presets plus a custom rate between 0.25× and 4×",
      "Optional pitch compensation using HTMLMediaElement.preservesPitch, with an honest note about browser support",
      "Shows the resulting duration before you start, and the real time the export will take",
      "Frame sampling drops to the source rate below 1× so slow motion is smooth instead of full of duplicate frames",
      "Above 1× frames are dropped rather than duplicated, exactly as a normal speed-up transcode does",
      "Cancel button that aborts a long recording cleanly",
    ],
    howItWorks: [
      "The source is played back at your chosen rate, which is what the browser's media element does natively",
      "Each composited frame is drawn to a canvas; the canvas sampling rate drops below 1× so no frame is stored twice",
      "The canvas is captured into a MediaRecorder alongside the audio track, which the browser has already rate-adjusted",
      "The result downloads with the new duration",
    ],
    faq: [
      {
        question: "Does pitch compensation actually work here?",
        answer:
          "Chrome and Firefox implement HTMLMediaElement.preservesPitch, and because we capture the audio straight out of the media element the compensation is present in the recording. Safari does not implement the property, so there the toggle has no effect and we say so instead of pretending.",
      },
      {
        question: "Why does a 0.5× slow-down take twice as long?",
        answer:
          "The browser encodes as fast as the video plays. Playing the source at half speed takes twice the wall-clock time, and the encoder follows it. The remaining-time readout is computed from the real playback rate, so it is accurate.",
      },
      {
        question: "Why are frames dropped when speeding up?",
        answer:
          "Because that is what a speed-up does. At 2× the source has 60 frames for every second of output, and a 30 fps export keeps 30 of them. Storing all 60 would double the frame rate for no extra information.",
      },
    ],
    related: ["video-trimmer", "video-compressor", "video-frames"],
  },
  {
    id: "video-frames",
    name: "Extract Video Frames",
    slug: "frames",
    category: "video",
    description:
      "Pull still images out of a video at an interval or at exact timestamps, as JPEG or PNG, individually or as a ZIP.",
    intro:
      "Pick how many frames you want or list the exact timestamps, then save them as JPEG or PNG — one by one or as a single ZIP. A contact sheet shows you what was actually captured.",
    icon: "Images",
    keywords: ["frames", "screenshots", "still", "snapshots", "extract images", "thumbnails"],
    route: "/tools/video/frames",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-04",
    actionLabel: "Extract frames",
    features: [
      "Capture N frames evenly across the clip, or supply explicit timestamps",
      "JPEG with a real quality slider, or lossless PNG",
      "Contact sheet of everything captured, with the exact timestamp on each thumbnail",
      "Download individually or as one ZIP",
      "Real progress across the frames, and a report of any timestamp the browser could not decode",
      "No recording pass at all — this is instant, because it only seeks and paints stills",
    ],
    howItWorks: [
      "Your file is opened in a hidden video element and its duration read from the container",
      "For each requested timestamp the element seeks, waits for the seek to complete, and the frame is painted to a canvas",
      "The canvas is read back and encoded as JPEG or PNG in the browser",
      "Frames download individually, or are zipped in one action",
    ],
    faq: [
      {
        question: "Why is this one instant when video conversion is not?",
        answer:
          "Because nothing is re-encoded. It seeks to a timestamp, paints one frame and takes a still. Seeking is fast, whereas MediaRecorder has to be fed frames in real time.",
      },
      {
        question: "Will a seek land on the exact frame I asked for?",
        answer:
          "It lands on the frame the decoder can present at that time, which is the nearest keyframe boundary. A seek to 4.03 s in a 30 fps video gives you the frame at or just before that timestamp, plus black bars if the display aspect differs from the coded one.",
      },
      {
        question: "What happens to timestamps the browser cannot decode?",
        answer:
          "They are reported. You get a count of how many were skipped and which ones, instead of a silent duplicate of the previous frame.",
      },
      {
        question: "Is there a limit on how many frames I can take?",
        answer:
          "We cap a single export at 200 frames, which keeps the ZIP manageable and the tab responsive. Beyond that, split the job.",
      },
    ],
    related: ["video-to-gif", "video-trimmer", "video-compressor"],
  },
  {
    id: "video-watermark",
    name: "Video Watermark",
    slug: "watermark",
    category: "video",
    description:
      "Burn text or an image watermark into a video with 9-point positioning, opacity, size and a tiled diagonal option.",
    intro:
      "Stamp text or your own logo onto a video, choose one of nine anchor positions, set the opacity and size, and optionally tile it diagonally across the frame. Burned in frame by frame during the export pass.",
    icon: "Sticker",
    keywords: ["watermark", "logo", "copyright", "stamp", "branding", "overlay"],
    route: "/tools/video/watermark",
    processing: "local",
    status: "beta",
    addedOn: "2026-02-12",
    actionLabel: "Apply watermark",
    features: [
      "Text watermark with size, colour, and outline so it stays legible over any footage",
      "Upload your own PNG or JPEG logo as an alternative to text",
      "Nine anchor positions plus a custom offset, and a tiled diagonal mode",
      "Opacity control from 5% to 100%",
      "A live preview of the composited frame so you can judge legibility before recording",
      "Real-time export with a Cancel button",
    ],
    howItWorks: [
      "The watermark is composited onto a canvas layer above each decoded video frame",
      "Position, size and opacity are applied in canvas pixel space, so the result is resolution-independent",
      "The canvas is captured into a MediaRecorder and the audio track is carried across",
      "The watermark is burned into the pixels — it cannot be removed afterwards, which is the point",
    ],
    faq: [
      {
        question: "Is the watermark removable?",
        answer:
          "No, and that is deliberate. It is composited into the video frames, so it is part of the picture. This is not a container-level metadata tag that any editor can simply delete.",
      },
      {
        question: "Why do small text watermarks turn to mush?",
        answer:
          "The encoder is working on a heavily downscaled frame. A watermark is usually most legible at a reasonable size with a contrasting outline — the preview shows you exactly what will be encoded, not an idealised version.",
      },
      {
        question: "Does the watermark scale with the video?",
        answer:
          "It is specified as a percentage of frame height, so the same settings look the same on a 720p and a 4K export. A pixel height is also available when you need an exact size.",
      },
      {
        question: "Can I use a transparent PNG?",
        answer:
          "Yes. The canvas composites your PNG's alpha channel, so a transparent logo composites correctly over the video. Use PNG for logos, JPEG if you do not need transparency.",
      },
    ],
    related: ["video-cropper", "video-resizer", "video-compressor"],
  },
  {
    id: "video-to-audio",
    name: "Video to Audio",
    slug: "to-audio",
    category: "video",
    description:
      "Extract the audio track from a video file and save it as WAV or MP3, using the browser's own decoder and a local MP3 encoder.",
    intro:
      "Pull the soundtrack out of any video the browser can decode and save it as WAV or MP3. There is no recording pass here, so it finishes in seconds rather than in real time.",
    icon: "Music",
    keywords: ["extract audio", "soundtrack", "mp3 from video", "m4a", "audio rip", "wav"],
    route: "/tools/video/to-audio",
    processing: "local",
    status: "beta",
    addedOn: "2026-02-12",
    actionLabel: "Extract audio",
    features: [
      "Decodes the container's audio track with the Web Audio API — no video is re-encoded",
      "Export as WAV at 16/24/32-bit, or MP3 at a real bitrate from 96 to 320 kbps",
      "Real output-size estimate before you start",
      "Reports the real sample rate, channel count, duration and peak level of the decoded track",
      "An explicit, non-generic error when the browser cannot decode the file's audio codec",
      "Instant export: no real-time recording, because the audio is decoded as a whole",
    ],
    howItWorks: [
      "The video file is handed to decodeAudioData, which reads the audio track and ignores the video",
      "The decoded AudioBuffer is analysed for duration, sample rate, channels and peak level",
      "You choose WAV bit depth or MP3 bitrate; a real size estimate is shown from the bitrate and duration",
      "The buffer is encoded in the browser and handed back as a download",
    ],
    faq: [
      {
        question: "Which audio codecs work?",
        answer:
          "Whatever your browser's decoder supports: AAC and MP3 in MP4, Opus and Vorbis in WebM, PCM in MOV. AC-3, DTS, TrueHD and ALAC are usually not decodable in a browser, and you will get a clear message saying the audio could not be decoded rather than a silent empty file.",
      },
      {
        question: "Why is this instant when video export is not?",
        answer:
          "Nothing is re-encoded in real time. The whole audio track is decoded into memory at once, processed, and written out — so a 40-minute film takes seconds, not 40 minutes.",
      },
      {
        question: "Does it re-encode or copy the audio?",
        answer:
          "It re-encodes. decodeAudioData gives you decoded PCM, and the output is encoded afresh. WAV at the source's own sample rate is lossless from that point; MP3 is lossy by definition.",
      },
      {
        question: "What if the video has no audio track?",
        answer:
          "Decoding fails or returns an empty buffer, and the tool tells you the file has no decodable audio instead of producing a zero-length file.",
      },
    ],
    related: ["audio-trimmer", "mp3-converter", "audio-normalizer"],
  },
];
