import { Inject, Injectable } from '@nestjs/common';
import { LIMITS } from '@touchgrass/shared';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

const run = promisify(execFile);

/** Any one ffmpeg/ffprobe call: a 15 s phone clip re-encodes in a few seconds; this only stops a hang. */
const STEP_TIMEOUT_MS = 120_000;
/**
 * Inputs are read from a local file only. Without this, a crafted file (an HLS playlist dressed as a .mov)
 * could make ffmpeg fetch URLs or read other local files.
 */
const LOCAL_ONLY = ['-protocol_whitelist', 'file'];
/** ffprobe's name for the ISO base media family (MP4, MOV, 3GP). Anything else is refused. */
const ISO_CONTAINER = /\b(mov|mp4)\b/;
/** A little over the limit, for container timestamps that round up. */
const MAX_SECONDS = LIMITS.upload.maxVideoSeconds + 0.5;

export class VideoRejected extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'VideoRejected';
  }
}

export interface TranscodedVideo {
  /** H.264 High / AAC MP4 with the moov atom first (streams before it finishes downloading), no metadata. */
  video: Buffer;
  /** The first frame as JPEG: the poster, rendered into the usual image variants. */
  poster: Buffer;
  /** Three frames across the clip, for image moderation. */
  samples: Buffer[];
  durationMs: number;
  width: number;
  height: number;
}

interface Probe {
  format?: { format_name?: string; duration?: string };
  streams?: { codec_type?: string; width?: number; height?: number }[];
}

/**
 * Video stories (D-164): every upload is re-encoded, never served as uploaded. The re-encode drops all
 * container metadata (GPS and device details on phone videos), applies the phone's rotation to the pixels,
 * caps the short side at 720 px and the length at 15 s.
 */
@Injectable()
export class VideoTranscoder {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async transcode(original: Buffer): Promise<TranscodedVideo> {
    const dir = await mkdtemp(join(tmpdir(), 'tg-video-'));
    try {
      const input = join(dir, 'input');
      const output = join(dir, 'output.mp4');
      await writeFile(input, original);
      const probe = await this.probe(input);
      if (!ISO_CONTAINER.test(probe.format?.format_name ?? ''))
        throw new VideoRejected('Not an MP4 or QuickTime file');
      if (!probe.streams?.some((s) => s.codec_type === 'video'))
        throw new VideoRejected('No video track');
      const seconds = Number(probe.format?.duration);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new VideoRejected('Unknown length');
      if (seconds > MAX_SECONDS) throw new VideoRejected('Longer than 15 seconds');

      await this.ffmpeg([
        ...LOCAL_ONLY,
        '-i',
        input,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-t',
        String(LIMITS.upload.maxVideoSeconds),
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-vf',
        // Short side at most 720 px, never upscaled, even dimensions (H.264 needs them).
        "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '26',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        output,
      ]);

      // Everything else is taken from our own output: upright, metadata-free, known codec.
      const out = await this.probe(output);
      const stream = out.streams?.find((s) => s.codec_type === 'video');
      const outSeconds = Number(out.format?.duration);
      if (!stream?.width || !stream.height || !Number.isFinite(outSeconds))
        throw new VideoRejected('Could not read the re-encoded video');
      const poster = await this.frameAt(output, 0, join(dir, 'poster.jpg'));
      const samples = await Promise.all(
        [0.2, 0.5, 0.8].map((at, i) =>
          this.frameAt(output, outSeconds * at, join(dir, `sample-${String(i)}.jpg`)),
        ),
      );
      return {
        video: await readFile(output),
        poster,
        samples,
        durationMs: Math.max(1, Math.round(outSeconds * 1000)),
        width: stream.width,
        height: stream.height,
      };
    } catch (err) {
      if (err instanceof VideoRejected) throw err;
      // ffmpeg could not decode it: a broken or disguised file, never retried.
      throw new VideoRejected(
        err instanceof Error ? err.message.slice(0, 200) : 'Unreadable video',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async probe(file: string): Promise<Probe> {
    const { stdout } = await run(
      this.env.FFPROBE_PATH,
      [
        '-v',
        'error',
        ...LOCAL_ONLY,
        '-show_entries',
        'format=format_name,duration:stream=codec_type,width,height',
        '-of',
        'json',
        file,
      ],
      { timeout: STEP_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    return JSON.parse(stdout) as Probe;
  }

  private async frameAt(file: string, seconds: number, out: string): Promise<Buffer> {
    await this.ffmpeg([
      ...LOCAL_ONLY,
      '-ss',
      seconds.toFixed(3),
      '-i',
      file,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-f',
      'image2',
      out,
    ]);
    return readFile(out);
  }

  private async ffmpeg(args: string[]): Promise<void> {
    await run(
      this.env.FFMPEG_PATH,
      ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args],
      {
        timeout: STEP_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
    );
  }
}
