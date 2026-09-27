import type { Tool } from "../types";

/**
 * Audio tools.
 *
 * Nine of the ten run entirely in the browser: decoding, editing and encoding
 * all happen on the visitor's own device, which is why a 40-minute track takes
 * seconds rather than a round trip.
 *
 * `audio-to-text` is the exception and is deliberately `setup-required` with
 * `processing: "server"`. The Web Speech API is not a transcription API — it is
 * unreliable, browser-limited and, in most implementations, forwards audio to a
 * vendor's cloud. Rather than ship a button that sometimes returns a fabricated
 * transcript, the workspace posts to a documented route and renders
 * `SetupRequired` when the operator has not configured a provider.
 */
export const AUDIO_TOOLS: readonly Tool[] = [
  {
    id: "mp3-converter",
    name: "MP3 Converter",
    slug: "mp3-converter",
    category: "audio",
    description:
      "Convert any decodable audio file to MP3 at 96–320 kbps. The encoder runs in your browser, so nothing is uploaded.",
    intro:
      "Turn any audio the browser can decode into an MP3 at a bitrate you choose. The encoder is a self-contained LAME port that runs in this tab, and the size estimate shown before you start is the real one.",
    icon: "Music",
    keywords: ["mp3", "convert to mp3", "wav to mp3", "m4a to mp3", "bitrate", "lame"],
    route: "/tools/audio/mp3-converter",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-08",
    actionLabel: "Convert to MP3",
    features: [
      "Real bitrate picker: 96, 128, 160, 192, 256 and 320 kbps",
      "Output-size estimate computed from the bitrate and the file's real duration",
      "Decodes MP3, WAV, M4A/AAC, OGG/Opus, WebM and FLAC — anything the browser can decode",
      "Resamples to 44.1 or 48 kHz and downmixes surround to stereo or mono, because LAME requires it",
      "Encodes in blocks and yields to the main thread, so a long track does not freeze the tab",
      "Batch up to 20 files with individual downloads or a single ZIP",
    ],
    howItWorks: [
      "Each file is decoded to an AudioBuffer with decodeAudioData",
      "The buffer is resampled to an MP3-native rate and downmixed to at most two channels",
      "A LAME encoder is driven in 1152-sample blocks, copying every encoded frame into one Blob",
      "The MP3 downloads, individually or zipped together",
    ],
    faq: [
      {
        question: "Is the MP3 encoding really local?",
        answer:
          "Yes. The encoder is a JavaScript port of LAME that is loaded on demand as a separate chunk and runs on your device. No audio is sent anywhere.",
      },
      {
        question: "Which bitrate should I pick?",
        answer:
          "128 kbps is transparent enough for speech and lossy sources, 192 kbps is the sweet spot for most music, and 320 kbps is for sources that were already lossy-encoded at a high bitrate. Encoding a 128 kbps file at 320 kbps wastes bytes and adds no quality.",
      },
      {
        question: "Why is my output larger than the input?",
        answer:
          "Because the input was already compressed efficiently — an Opus or Vorbis file often beats MP3 at the same perceived quality. Re-encoding to MP3 at a high bitrate will always be larger. Use the WAV converter if you need to keep the size down.",
      },
      {
        question: "Why can the MP3 not keep my 5.1 surround channels?",
        answer:
          "MP3 as implemented here is mono or stereo, which is what every consumer player expects. Surround is downmixed, not dropped: the extra channels are averaged into the stereo pair.",
      },
    ],
    related: ["wav-converter", "audio-trimmer", "video-to-audio"],
  },
  {
    id: "wav-converter",
    name: "WAV Converter",
    slug: "wav-converter",
    category: "audio",
    description:
      "Convert audio to uncompressed WAV at 16, 24 or 32-bit and 8 kHz–48 kHz, mono or stereo, with a correct RIFF header.",
    intro:
      "Write a clean, standards-compliant RIFF/WAVE file at the bit depth and sample rate you need. No compression, no surprises, and a size you can predict exactly from the numbers.",
    icon: "FileAudio",
    keywords: ["wav", "convert to wav", "pcm", "uncompressed", "sample rate", "bit depth"],
    route: "/tools/audio/wav-converter",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-08",
    actionLabel: "Convert to WAV",
    features: [
      "16, 24 and 32-bit PCM output, all with a correctly written RIFF header",
      "Sample-rate picker from 8 kHz to 48 kHz, resampled with OfflineAudioContext",
      "Mono or stereo, downmixing surround rather than discarding channels",
      "Exact size preview: frames × block align + header, not an estimate",
      "Instant — no real-time recording and no lossy intermediate step",
      "Batch up to 20 files with individual downloads or a single ZIP",
    ],
    howItWorks: [
      "The file is decoded to an AudioBuffer",
      "If you pick a different sample rate, an OfflineAudioContext resamples it properly",
      "Samples are clamped and written as little-endian PCM into a DataView with RIFF, fmt, fact and data chunks",
      "The finished Blob is handed to you with an audio/wav type",
    ],
    faq: [
      {
        question: "What is the `fact` chunk in the output?",
        answer:
          "16-bit PCM is a plain RIFF/WAVE file. 24- and 32-bit PCM are only formally valid with a fact chunk declaring the sample-frame count, so the writer emits one. It costs 12 bytes and makes the file readable by strict parsers.",
      },
      {
        question: "Which bit depth should I choose?",
        answer:
          "16-bit is what CD audio uses and is plenty for nearly all work. 24-bit is the working standard in audio editing and leaves real headroom for processing. 32-bit PCM is for archival work; float WAV is a different thing entirely and is not what this produces.",
      },
      {
        question: "Why is the output so much bigger than the input?",
        answer:
          "Because WAV is uncompressed. One second of 24-bit stereo at 48 kHz is 288 KB, so a four-minute track is about 69 MB. That is the honest arithmetic, and it is why the size is shown before you start.",
      },
      {
        question: "Can I go from 48 kHz to 44.1 kHz without artefacts?",
        answer:
          "Yes — the resample runs through an OfflineAudioContext, which applies a proper polyphase filter. It is not a cheap nearest-neighbour drop, though no rate conversion can add detail that was never recorded.",
      },
    ],
    related: ["mp3-converter", "audio-trimmer", "audio-normalizer"],
  },
  {
    id: "audio-trimmer",
    name: "Audio Trimmer",
    slug: "trimmer",
    category: "audio",
    description:
      "Trim audio to exact in and out points on a real waveform, preview the selection, and export with optional fades.",
    intro:
      "Cut audio precisely on a waveform drawn from the actual decoded samples, with in and out handles, timecode readouts, a selection-only preview and adjustable fade lengths to kill clicks.",
    icon: "Scissors",
    keywords: ["trim", "cut", "clip", "split audio", "fade", "waveform"],
    route: "/tools/audio/trimmer",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-15",
    actionLabel: "Export selection",
    features: [
      "Waveform drawn from real min/max peaks per pixel column, not a decorative curve",
      "In and out handles draggable with a mouse, a finger, or the arrow keys",
      "Numeric timecode fields and a live selection duration in seconds and frames",
      "Preview player that loops only the selected range",
      "Fade-in and fade-out lengths in milliseconds, applied as equal-power ramps to prevent clicks",
      "Export as WAV or MP3, with a real size estimate",
    ],
    howItWorks: [
      "The file is decoded to an AudioBuffer and reduced to min/max peaks per canvas column",
      "Your in and out points are stored in seconds and clamped so out is always after in",
      "On export the range is copied sample-accurately and the fades are applied in place",
      "The buffer is encoded to WAV or MP3 and downloaded",
    ],
    faq: [
      {
        question: "Is the cut sample-accurate?",
        answer:
          "Yes. The range is copied by sample index, not by re-rendering through a time window, so you get exactly the samples between your two points. Fades are the only thing added on top.",
      },
      {
        question: "Why do I need fades?",
        answer:
          "Because a hard cut leaves a discontinuity between two unrelated waveforms, which is an audible click. A 5–20 ms ramp at each end removes it entirely, and the tool applies them for you.",
      },
      {
        question: "The waveform looks flat in places — is that a bug?",
        answer:
          "No, that is the signal. Genuine silence, a heavily limited section and a very quiet passage all look flat, which is exactly what makes the waveform useful for choosing cut points.",
      },
      {
        question: "Can I undo?",
        answer:
          "Nothing is destructive. The original file is untouched; move the handles and export again as often as you like.",
      },
    ],
    related: ["audio-splitter", "remove-silence", "wav-converter"],
  },
  {
    id: "audio-merger",
    name: "Audio Merger",
    slug: "merger",
    category: "audio",
    description:
      "Join several audio files into one, in an order you control, with a gap between tracks, per-track gain and fades.",
    intro:
      "Stack several recordings end to end. Drag to reorder, set the silence between tracks, trim each one up with its own gain and fade, and hear the real total duration before you merge.",
    icon: "Combine",
    keywords: ["merge", "join", "combine", "concatenate", "stitch", "append"],
    route: "/tools/audio/merger",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-15",
    actionLabel: "Merge tracks",
    features: [
      "Up to 20 files, reorderable by drag and drop",
      "A real gap-in-seconds control, with a live total-duration readout that accounts for it",
      "Per-track gain in dB and per-track fade in/out, applied in the audio graph",
      "Files with different sample rates are resampled to a common rate before joining",
      "Stereo or mono is decided by the widest track in the set",
      "Export as WAV or MP3 with a size estimate",
    ],
    howItWorks: [
      "Every file is decoded, then tracks are ordered and a common sample rate chosen from the source material",
      "An OfflineAudioContext is created at the exact total length, gaps included",
      "Each track is scheduled as a BufferSource feeding a GainNode that carries its fade automation",
      "The rendered buffer is encoded and downloaded",
    ],
    faq: [
      {
        question: "What happens if my files have different sample rates?",
        answer:
          "They are resampled to a common rate first, chosen from the source material so nothing is needlessly degraded. Without that step, concatenating a 44.1 kHz and a 48 kHz file would play the second one at the wrong speed.",
      },
      {
        question: "How big is the gap between tracks?",
        answer:
          "Whatever you set, in seconds, and it applies between each pair — so four tracks with a 0.5 s gap produce three gaps. The total-duration readout includes them.",
      },
      {
        question: "Why use a fade on each track?",
        answer:
          "Because cutting a waveform mid-cycle makes a click. A short fade at the head and tail of each track is what makes a joined file sound like one recording.",
      },
      {
        question: "Can I merge files of different lengths?",
        answer:
          "Yes, that is the point. Each track keeps its own length; only the gap is fixed.",
      },
    ],
    related: ["audio-splitter", "audio-trimmer", "wav-converter"],
  },
  {
    id: "audio-splitter",
    name: "Audio Splitter",
    slug: "splitter",
    category: "audio",
    description:
      "Split audio into fixed-length chunks, equal parts, or sections at detected silence — then download them individually or as a ZIP.",
    intro:
      "Break one file into pieces by a fixed duration, into a set number of equal parts, or at the silences we actually find in the samples. Every part is a real, separately playable file.",
    icon: "Split",
    keywords: ["split", "chunks", "segments", "divide", "cut into parts", "silence"],
    route: "/tools/audio/splitter",
    processing: "local",
    status: "stable",
    addedOn: "2026-01-22",
    actionLabel: "Split audio",
    features: [
      "Split every N seconds, split into K equal parts, or split at detected silence",
      "Silence detection runs on real sample data with a dBFS threshold and a minimum silence length",
      "Live preview of the plan: part count, part length, and where the silence cuts fall",
      "Crossfade length at each boundary so joined parts do not click",
      "Download parts individually or as one ZIP",
      "Export as WAV or MP3",
    ],
    howItWorks: [
      "The file is decoded to an AudioBuffer and the split plan is computed from its real duration",
      "For a silence split, 10 ms RMS windows are gated at your threshold and runs longer than your minimum are collected",
      "Each part is sliced by sample index and given an equal-power crossfade at its edges",
      "Every part is encoded and either downloaded separately or zipped together",
    ],
    faq: [
      {
        question: "How does silence splitting decide where to cut?",
        answer:
          "It measures RMS level in 10 ms windows and marks a window silent when it falls below your dBFS threshold. Runs of silent windows longer than your minimum become candidate cut points, and the cut lands in the middle of the silence so nothing audible is clipped.",
      },
      {
        question: "Why is it called a splitter and not a chopper?",
        answer:
          "Because the cut points are chosen, not blind. With silence mode the goal is one part per thought, which is what a fixed-duration split cannot do.",
      },
      {
        question: "Can I choose the part count before splitting?",
        answer:
          "Yes, in equal mode. Give it a number of parts and the file is divided into that many near-identical chunks. In fixed mode you give a length instead; in silence mode the count is whatever the audio contains.",
      },
    ],
    related: ["audio-trimmer", "remove-silence", "audio-merger"],
  },
  {
    id: "volume-booster",
    name: "Audio Volume Booster",
    slug: "volume-booster",
    category: "audio",
    description:
      "Raise audio by up to +24 dB with real clipping detection and an optional soft limiter that genuinely prevents clipping.",
    intro:
      "Turn quiet recordings up. The tool measures the result sample by sample, tells you exactly how many samples would clip, and offers a soft limiter that stops that from happening instead of letting you find out in your speakers.",
    icon: "Volume2",
    keywords: ["volume", "boost", "louder", "amplify", "gain", "quiet", "clipping"],
    route: "/tools/audio/volume-booster",
    processing: "local",
    status: "stable",
    popular: true,
    addedOn: "2026-01-22",
    actionLabel: "Boost volume",
    features: [
      "Gain in dB from −24 to +24, or a plain percentage for the timid",
      "Peak level before and after in dBFS, measured from the real samples",
      "Clipping detection: the exact count of samples at or beyond ±1.0 in the boosted result",
      "Optional soft limiter — a tanh shoulder above a knee, which provably keeps every sample inside ±1",
      "Warns before you export if the requested gain will clip and no limiter is enabled",
      "Export as WAV or MP3",
    ],
    howItWorks: [
      "The file is decoded and analysed: peak, RMS, sample rate, channel count and any existing clipped samples",
      "The requested linear gain is applied to every channel, and the new peak is measured",
      "If a limiter is on, samples above the knee are passed through a tanh shoulder instead of being left to clip",
      "The result is measured again and encoded to WAV or MP3",
    ],
    faq: [
      {
        question: "What is dBFS?",
        answer:
          "Decibels relative to full scale. 0 dBFS is the maximum the format can represent, and every number below it is negative. A typical mastered track peaks around −8 to −10 dBFS, which is why you can often add that much gain before anything goes wrong.",
      },
      {
        question: "What is the difference between hard clipping and the soft limiter?",
        answer:
          "Hard clipping truncates anything above ±1, which produces a square wave and is audibly harsh. The soft limiter leaves samples below the knee untouched and compresses only the peaks into a tanh curve, so loud moments sound compressed rather than broken.",
      },
      {
        question: "Why does boosting a very quiet file amplify noise?",
        answer:
          "Because the noise floor is part of the recording. Raising everything by 18 dB raises the hiss by 18 dB too. If that is a problem, normalisation to a target level will get you further with less noise — but it cannot remove hiss either.",
      },
      {
        question: "Does this actually amplify without a sound source?",
        answer:
          "It applies a linear gain to the samples, which is what a preamp does. There is no 'extracting' extra loudness that was not recorded — quiet material stays quiet relative to its own noise floor.",
      },
    ],
    related: ["audio-normalizer", "audio-trimmer", "wav-converter"],
  },
  {
    id: "audio-normalizer",
    name: "Audio Normalizer",
    slug: "normalizer",
    category: "audio",
    description:
      "Normalise audio to a target peak level or an approximate loudness target, with a real limiter and a guard for silent files.",
    intro:
      "Even out the level of a recording. Pick a target peak in dBFS or a loudness approximation, let the tool measure the file, and add a limiter so normalising never pushes it into clipping.",
    icon: "Gauge",
    keywords: ["normalise", "normalize", "loudness", "lufs", "levels", "mastering", "gain staging"],
    route: "/tools/audio/normalizer",
    processing: "local",
    status: "stable",
    addedOn: "2026-02-04",
    actionLabel: "Normalise",
    features: [
      "Peak normalisation to a target dBFS, measured from the file's real peak",
      "Loudness approximation based on measured RMS, clearly labelled as an approximation — not LUFS",
      "Soft limiter to catch the peaks that a loudness-based gain would push over the ceiling",
      "Guard that skips files quieter than a threshold, so a silent recording is not boosted into noise",
      "Shows the applied gain, the before and after peak, and the limiter's work in dB",
      "Export as WAV or MP3",
    ],
    howItWorks: [
      "The file is decoded and analysed for peak level and RMS loudness",
      "The gain needed to reach your target is computed — from the peak, or from the RMS approximation",
      "The silence guard is applied: if the source is below your floor, the file is left alone and we say so",
      "Gain is applied, the limiter catches anything over the ceiling, and the result is re-measured and encoded",
    ],
    faq: [
      {
        question: "Is this real LUFS normalisation?",
        answer:
          "No, and we would rather say so. A true LUFS implementation needs an integrated-loudness algorithm with K-weighting filters and gated block measurement, as in EBU R128. What this offers is a real peak normalisation and an RMS-based loudness approximation. The UI labels it that way.",
      },
      {
        question: "Which should I use — peak or loudness?",
        answer:
          "Peak for anything that has to line up with other material, such as a batch of voice clips. Loudness approximation for a single finished track where you want the average to sit at a level you can predict.",
      },
      {
        question: "Why was my file skipped?",
        answer:
          "The guard you set. Normalising a file whose peak is below that floor would multiply noise up to full scale, so we leave it alone and tell you rather than producing a hiss.",
      },
      {
        question: "What does the limiter do?",
        answer:
          "It compresses samples that would exceed the ceiling using the same tanh shoulder as the volume booster, so the output never clips. The readout shows how much gain reduction it had to apply.",
      },
    ],
    related: ["volume-booster", "wav-converter", "audio-trimmer"],
  },
  {
    id: "remove-silence",
    name: "Remove Silence",
    slug: "remove-silence",
    category: "audio",
    description:
      "Cut silent stretches out of a recording using a real dBFS threshold, with a minimum length, padding, and a list of exactly what was removed.",
    intro:
      "Set a threshold, a minimum silence length and a little padding, and the silent stretches come out. You get a list of every range that was removed with its duration, so nothing disappears without you seeing it.",
    icon: "AudioWaveform",
    keywords: ["remove silence", "silence", "gap", "trim silence", "vad", "podcast"],
    route: "/tools/audio/remove-silence",
    processing: "local",
    status: "beta",
    addedOn: "2026-02-12",
    actionLabel: "Remove silence",
    features: [
      "Threshold from −80 to −20 dBFS, a minimum silence length, and a padding guard at each cut",
      "Detection runs on real samples: RMS per 10 ms window, not a guess",
      "Every removed range is listed with its start, end and duration",
      "Total time saved, before and after, in real seconds",
      "Padding keeps a sliver of silence at each cut so words do not get clipped",
      "Preview the result before exporting as WAV or MP3",
    ],
    howItWorks: [
      "The file is decoded and reduced to a mono signal for level analysis",
      "10 ms RMS windows below your threshold are grouped into silent runs",
      "Runs longer than your minimum are trimmed back by the padding and turned into cut ranges",
      "The kept ranges are concatenated, faded at the seams, and encoded",
    ],
    faq: [
      {
        question: "Why is this marked beta?",
        answer:
          "Because this is a level gate, not a voice-activity detector. It will happily remove a very quiet sustained note, and it will not cut a gap that has hiss above your threshold. Real VAD needs an ML model or at least spectral analysis, neither of which we run locally.",
      },
      {
        question: "What threshold should I use?",
        answer:
          "For speech recorded in a quiet room, −45 to −40 dBFS is a good starting point. For a noisy recording, raise it to around −35 dBFS or the noise floor will be cut into fragments. The tool shows you the detected ranges so you can judge.",
      },
      {
        question: "What is the padding for?",
        answer:
          "It keeps a fraction of a second of the silence on each side of a cut. Without it, a breath or the tail of a word gets clipped along with the silence, which is the most common way this kind of tool sounds wrong.",
      },
      {
        question: "Will it remove the gaps between my sentences?",
        answer:
          "Yes — that is the point, and the minimum silence length is what stops it from chopping between every word. Set the minimum to roughly the longest pause you want to keep.",
      },
    ],
    related: ["audio-trimmer", "audio-splitter", "audio-normalizer"],
  },
  {
    id: "audio-speed",
    name: "Change Audio Speed",
    slug: "speed",
    category: "audio",
    description:
      "Change audio speed from 0.5× to 2×, either by resampling (instant, pitch shifts) or by the browser's pitch-preserving time stretch.",
    intro:
      "Two genuinely different options, labelled honestly: an instant resample that changes pitch like a tape machine, and a real-time pitch-preserving stretch done by the browser where it supports one.",
    icon: "Timer",
    keywords: ["speed", "tempo", "faster", "slower", "pitch", "time stretch", "rate"],
    route: "/tools/audio/speed",
    processing: "local",
    status: "beta",
    addedOn: "2026-02-12",
    actionLabel: "Change speed",
    features: [
      "0.5× to 2.0× in 0.05 steps, with the resulting duration shown live",
      "Resample mode: instant, artefact-free, pitch shifts by the speed factor — labelled as such",
      "Pitch-preserving mode: the browser time-stretches, so pitch stays put but the job runs in real time",
      "Honest capability check — if the browser has no preservesPitch, the option is marked unavailable",
      "Fade controls to stop the resample from clicking at the very start and end",
      "Export as WAV or MP3",
    ],
    howItWorks: [
      "The file is decoded to an AudioBuffer and the new duration computed from your rate",
      "Resample mode reinterprets the same samples at a new sample rate, which changes pitch by the same factor",
      "Pitch-preserve mode plays the file through a media element with preservesPitch enabled and records the result",
      "Fades are applied and the buffer is encoded to WAV or MP3",
    ],
    faq: [
      {
        question: "Which mode should I use?",
        answer:
          "Resample for anything where a pitch change is acceptable or desirable — a chipmunk voice effect, or a demo played back faster. Pitch-preserving for speech, music and anything where a shifted pitch is a bug.",
      },
      {
        question: "Why is pitch-preserving mode so much slower?",
        answer:
          "It has to be. There is no instant Web Audio primitive for a pitch-preserving time stretch, so we use the one the browser already has — the media element's pitch compensation — which means playing the file at the new speed and recording the result. A 30-minute file takes 15 minutes at 2×.",
      },
      {
        question: "Does my browser support pitch preservation?",
        answer:
          "Chrome, Edge and Firefox do, via HTMLMediaElement.preservesPitch. Safari does not implement the property at all, so the option is marked unavailable there rather than silently producing a pitch-shifted file.",
      },
      {
        question: "Why do speed changes click?",
        answer:
          "Because a resampled waveform can start or end mid-cycle, and a step from nothing to something is a discontinuity. A few milliseconds of fade at each end removes it, which is why the fades are on by default.",
      },
    ],
    related: ["audio-trimmer", "mp3-converter", "wav-converter"],
  },
  {
    id: "audio-to-text",
    name: "Audio to Text",
    slug: "to-text",
    category: "audio",
    description:
      "Transcribe an audio file to text. Needs a server-side transcription provider, which this deployment has not configured yet.",
    intro:
      "The interface is complete and the request is real, but transcription has to happen on a server: the browser's own Web Speech API is not a transcription API, and most implementations quietly send your audio to a vendor. This deployment has no provider configured, so the tool says so rather than inventing a transcript.",
    icon: "Mic",
    keywords: ["transcribe", "transcription", "speech to text", "dictate", "subtitles", "captions"],
    route: "/tools/audio/to-text",
    processing: "server",
    status: "setup-required",
    addedOn: "2026-02-19",
    actionLabel: "Transcribe",
    setupNote:
      "Speech-to-text needs a server-side transcription provider, which this deployment has not configured.\n\nAdd to your environment:\n  TRANSCRIPTION_API_URL=https://api.your-provider.com/v1/audio/transcriptions\n  TRANSCRIPTION_API_KEY=…\n\nThen implement POST /api/tools/audio/transcribe (multipart upload, Zod-validated, rate-limited) and flip this tool's status to \"stable\".",
    features: [
      "Full upload, language and model controls, wired to a real multipart POST to /api/tools/audio/transcribe",
      "Language selection and a quality/model choice passed straight through to the provider",
      "Renders the provider's own error when the route is missing, so a 501 or 404 becomes a clear setup message",
      "Transcripts can be copied, downloaded as .txt, or shown with the timings the provider returns",
      "Renders SetupRequired with the exact environment variables when no provider is configured",
      "Never fabricates a transcript — if the provider does not return one, you get an error",
    ],
    howItWorks: [
      "You choose a file, a language and a model, then the workspace posts the audio as multipart form data",
      "The server route validates the upload with Zod, checks the rate limit, and forwards it to the configured provider",
      "The provider's response is returned as JSON with the text and any segment timings",
      "If the route is not implemented, the response is a 501 and the workspace renders the setup instructions",
    ],
    faq: [
      {
        question: "Why does this not work in my browser?",
        answer:
          "Because the Web Speech API's SpeechRecognition is not a transcription API. It is only implemented for live microphone input, it differs across browsers, and in most cases it streams your audio to a third-party cloud. Shipping it as a 'local' transcription tool would be a lie about where your audio goes.",
      },
      {
        question: "What does the deployment need?",
        answer:
          "A TRANSCRIPTION_API_URL and TRANSCRIPTION_API_KEY in the environment, plus a POST /api/tools/audio/transcribe route that accepts a multipart upload, validates it, applies a rate limit, and returns { text, segments }.",
      },
      {
        question: "Will my audio be stored?",
        answer:
          "The route should stream the upload straight to the provider and delete any temporary copy when the request ends. Until an operator implements it, nothing is uploaded at all, because there is nowhere to upload to.",
      },
      {
        question: "Can I use it offline instead?",
        answer:
          "Not in the browser. Local transcription needs a speech model — Whisper and its descendants are hundreds of megabytes — which would have to be downloaded before the tool could be used at all. That is a different product decision, and we would rather be explicit about it.",
      },
    ],
    related: ["audio-trimmer", "mp3-converter", "wav-converter"],
  },
];
