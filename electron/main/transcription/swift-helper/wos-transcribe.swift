import AVFoundation
import Foundation
import Speech

struct Segment: Codable {
  let speaker: String?
  let start: Double?
  let end: Double?
  let text: String
}

struct Output: Codable {
  let segments: [Segment]
}

actor SegmentStore {
  private var segments: [Segment] = []

  func append(_ segment: Segment) {
    segments.append(segment)
  }

  func all() -> [Segment] {
    segments
  }
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

@available(macOS 26.0, *)
func transcribeFile(_ url: URL) async throws -> Output {
  let transcriber = SpeechTranscriber(locale: Locale.current, preset: .timeIndexedTranscriptionWithAlternatives)
  let analyzer = SpeechAnalyzer(modules: [transcriber])
  let audioFile = try AVAudioFile(forReading: url)
  let segmentStore = SegmentStore()

  let collector = Task {
    for try await result in transcriber.results {
      let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
      if text.isEmpty { continue }
      await segmentStore.append(Segment(
        speaker: nil,
        start: result.range.start.seconds,
        end: result.range.end.seconds,
        text: text
      ))
    }
  }

  let lastSampleTime = try await analyzer.analyzeSequence(from: audioFile)
  if let lastSampleTime {
    try await analyzer.finalizeAndFinish(through: lastSampleTime)
  }

  _ = try await collector.value
  let segments = await segmentStore.all()
  return Output(segments: segments)
}

func writeWavTemp(pcm: Data, sampleRate: Double, channels: UInt16) throws -> URL {
  // 16-bit signed little-endian PCM
  let byteRate = UInt32(sampleRate) * UInt32(channels) * 2
  let blockAlign = channels * 2
  let dataSize = UInt32(pcm.count)
  let chunkSize = 36 + dataSize

  var header = Data(capacity: 44)
  header.append("RIFF".data(using: .ascii)!)
  header.append(withUnsafeBytes(of: chunkSize.littleEndian) { Data($0) })
  header.append("WAVE".data(using: .ascii)!)
  header.append("fmt ".data(using: .ascii)!)
  header.append(withUnsafeBytes(of: UInt32(16).littleEndian) { Data($0) })
  header.append(withUnsafeBytes(of: UInt16(1).littleEndian) { Data($0) }) // PCM
  header.append(withUnsafeBytes(of: channels.littleEndian) { Data($0) })
  header.append(withUnsafeBytes(of: UInt32(sampleRate).littleEndian) { Data($0) })
  header.append(withUnsafeBytes(of: byteRate.littleEndian) { Data($0) })
  header.append(withUnsafeBytes(of: blockAlign.littleEndian) { Data($0) })
  header.append(withUnsafeBytes(of: UInt16(16).littleEndian) { Data($0) }) // bits per sample
  header.append("data".data(using: .ascii)!)
  header.append(withUnsafeBytes(of: dataSize.littleEndian) { Data($0) })

  var wav = header
  wav.append(pcm)

  let url = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("wos-stream-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString).wav")
  try wav.write(to: url)
  return url
}

func emitJson(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

@available(macOS 26.0, *)
func transcribeStream(sampleRate: Double, channels: UInt16) async throws {
  // Reads raw little-endian Int16 PCM from stdin in chunks. Every ~5 seconds
  // of buffered audio, builds a temp WAV file and runs file-mode
  // transcription, emitting NDJSON `{"segment":{...}}` events as we go. On
  // EOF, flushes any remaining buffer and emits a final
  // `{"final":true,"segments":[...]}`.
  let stdin = FileHandle.standardInput
  let chunkSeconds: Double = 5.0
  let chunkBytes = Int(sampleRate * Double(channels) * 2 * chunkSeconds)
  var buffer = Data()
  var allSegments: [Segment] = []

  func flushChunk() async {
    guard !buffer.isEmpty else { return }
    let chunk = buffer
    buffer = Data()
    do {
      let url = try writeWavTemp(pcm: chunk, sampleRate: sampleRate, channels: channels)
      defer { try? FileManager.default.removeItem(at: url) }
      let output = try await transcribeFile(url)
      for segment in output.segments {
        allSegments.append(segment)
        var payload: [String: Any] = ["text": segment.text]
        if let s = segment.start { payload["start"] = s }
        if let e = segment.end { payload["end"] = e }
        emitJson(["segment": payload])
      }
    } catch {
      // Skip this chunk; keep streaming.
      FileHandle.standardError.write(Data("stream chunk failed: \(error)\n".utf8))
    }
  }

  while true {
    let data = stdin.availableData
    if data.isEmpty { break }
    buffer.append(data)
    if buffer.count >= chunkBytes {
      await flushChunk()
    }
  }
  await flushChunk()

  let finalSegments = allSegments.map { seg -> [String: Any] in
    var payload: [String: Any] = ["text": seg.text]
    if let s = seg.start { payload["start"] = s }
    if let e = seg.end { payload["end"] = e }
    return payload
  }
  emitJson(["final": true, "segments": finalSegments])
}

@main
struct WosTranscribe {
  static func main() async {
    let args = CommandLine.arguments
    guard args.count >= 2 else {
      fail("usage: wos-transcribe file <audio-or-video-path>\n   or: wos-transcribe stream <sampleRate> [channels]")
    }

    let subcommand = args[1]
    if subcommand == "file" {
      guard args.count >= 3 else { fail("usage: wos-transcribe file <audio-or-video-path>") }
      if #available(macOS 26.0, *) {
        do {
          let output = try await transcribeFile(URL(fileURLWithPath: args[2]))
          let data = try JSONEncoder().encode(output)
          FileHandle.standardOutput.write(data)
          FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
          fail("transcription failed: \(error)")
        }
      } else {
        fail("WOS local transcription requires macOS 26 or newer")
      }
      return
    }

    if subcommand == "stream" {
      guard args.count >= 3, let rate = Double(args[2]) else {
        fail("usage: wos-transcribe stream <sampleRate> [channels]")
      }
      let channels: UInt16 = args.count >= 4 ? (UInt16(args[3]) ?? 1) : 1
      if #available(macOS 26.0, *) {
        do {
          try await transcribeStream(sampleRate: rate, channels: channels)
        } catch {
          fail("stream failed: \(error)")
        }
      } else {
        fail("WOS local transcription requires macOS 26 or newer")
      }
      return
    }

    fail("usage: wos-transcribe file <audio-or-video-path>\n   or: wos-transcribe stream <sampleRate> [channels]")
  }
}
