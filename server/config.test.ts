// 이 파일이 하는 일: 실행 설정(loadConfig)의 기본값(포트 8090, 주소 ::)·환경 변수 우선순위·config.json·잘못된 값의 한국어 오류를 확인한다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ConfigError, DEFAULT_HOST, DEFAULT_PORT, loadConfig } from './config.ts';
import { makeTmpDir } from '../tests/helpers/tmp-dir.ts';

let tmp: string;
beforeEach(() => {
  tmp = makeTmpDir('dentalax-config-');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('loadConfig', () => {
  test('phase-01-task-01 AC2: 아무 설정이 없으면 포트 8090, ./data, ./backups, 이중 스택 주소 ::을 쓴다', () => {
    const c = loadConfig({}, tmp);
    expect(DEFAULT_PORT).toBe(8090);
    expect(DEFAULT_HOST).toBe('::');
    expect(c.port).toBe(8090);
    expect(c.host).toBe('::');
    expect(c.dataDir).toBe(path.join(tmp, 'data'));
    expect(c.backupDir).toBe(path.join(tmp, 'backups'));
    expect(c.allowExternal).toBe(false);
    expect(c.testNow).toBeNull();
  });

  test('phase-01-task-01 AC2: data/config.json의 port를 읽고, 환경 변수 PORT가 그보다 우선한다', () => {
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir);
    // 메모장이 붙이는 BOM이 있어도 읽혀야 한다
    fs.writeFileSync(path.join(dataDir, 'config.json'), '﻿{"port": 8091, "allowExternal": true}');
    expect(loadConfig({}, tmp).port).toBe(8091);
    expect(loadConfig({}, tmp).allowExternal).toBe(true);
    expect(loadConfig({ PORT: '18190' }, tmp).port).toBe(18190);
  });

  test('phase-01-task-01 AC4: 잘못된 포트·깨진 설정 파일은 한국어 원인과 해결 방법을 담은 ConfigError를 낸다', () => {
    expect(() => loadConfig({ PORT: 'abc' }, tmp)).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: '70000' }, tmp)).toThrow(/1부터 65535 사이/);
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'config.json'), '{ port: 80');
    expect(() => loadConfig({}, tmp)).toThrow(/형식이 올바르지 않아요/);
  });

  test('phase-01-task-01 AC4: 기다리는 주소는 config.json의 host로 바꿀 수 있고 환경 변수 HOST가 우선하며, IP가 아니면 한국어 오류를 낸다', () => {
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'config.json'), '{"host": "0.0.0.0"}');
    expect(loadConfig({}, tmp).host).toBe('0.0.0.0');
    expect(loadConfig({ HOST: '127.0.0.1' }, tmp).host).toBe('127.0.0.1');
    expect(() => loadConfig({ HOST: '우리병원' }, tmp)).toThrow(/주소 값 "우리병원"이\(가\) 올바르지 않아요/);
    fs.writeFileSync(path.join(dataDir, 'config.json'), '{"host": 8090}');
    expect(() => loadConfig({}, tmp)).toThrow(ConfigError);
  });

  test('phase-01-task-01: TEST_NOW는 테스트에서만 쓰고 production에서는 무시한다', () => {
    expect(loadConfig({ TEST_NOW: '2026-11-02T09:00:00+09:00' }, tmp).testNow).toBe('2026-11-02T09:00:00+09:00');
    expect(loadConfig({ TEST_NOW: '2026-11-02T09:00:00+09:00', NODE_ENV: 'production' }, tmp).testNow).toBeNull();
    expect(() => loadConfig({ TEST_NOW: '어제' }, tmp)).toThrow(ConfigError);
  });
});
