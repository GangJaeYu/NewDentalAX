// 이 파일이 하는 일: 회의록 녹음 받아쓰기 화면 도구(minutesLib.ts, phase-06-task-03)를 확인한다. 화면이 먼저 막는 형식·크기가 서버 기준과 같은지,
// 녹음 길이 글, 받아쓴 글 정리를 본다.
import { describe, expect, test } from 'vitest';
import { checkFile } from '../../lib/image.ts';
import { AUDIO_EXTS, TRANSCRIBE_MAX_BYTES } from '../../../../server/ai/transcribe.ts';
import { durationText, RECORDING_ACCEPT, RECORDING_MAX_BYTES, transcriptToNotes } from './minutesLib.ts';

describe('phase-06-task-03 회의 녹음 화면 도구', () => {
  test('phase-06-task-03 AC3: 화면도 서버와 같은 기준(20MB, m4a·mp3·wav·webm)으로 먼저 막는다', () => {
    expect(RECORDING_MAX_BYTES).toBe(TRANSCRIBE_MAX_BYTES);
    expect([...RECORDING_ACCEPT]).toEqual(AUDIO_EXTS);
    const rule = { accept: RECORDING_ACCEPT, maxBytes: RECORDING_MAX_BYTES };
    expect(checkFile({ name: '회의.m4a', size: 20 * 1024 * 1024 }, rule)).toBeNull();
    expect(checkFile({ name: '회의.m4a', size: 20 * 1024 * 1024 + 1 }, rule)).toBe('파일이 너무 커요(20MB). 20MB 이하로 올려 주세요.');
    expect(checkFile({ name: '회의.txt', size: 10 }, rule)).toBe('M4A·MP3·WAV·WEBM 파일만 올릴 수 있어요.');
  });

  test('phase-06-task-03 AC1: 녹음 길이를 쉬운 글로 보이고, 받아쓴 글은 빈 줄만 정리해 메모 칸에 넣는다', () => {
    expect(durationText(30)).toBe('약 30초');
    expect(durationText(120)).toBe('약 2분');
    expect(durationText(95)).toBe('약 1분 35초');
    expect(durationText(null)).toBeNull();
    expect(durationText(0)).toBeNull();
    expect(transcriptToNotes('\r\n[데모 응답] 예시\r\n\r\n\r\n\r\n실장: 시작\n')).toBe('[데모 응답] 예시\n\n실장: 시작');
  });
});
