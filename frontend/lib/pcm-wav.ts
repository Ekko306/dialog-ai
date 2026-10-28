/**
 * Int16 PCM → WAV 封装（008 T002，data-model 工具格式）：
 * 「我的」回放用——跟读录音为 16kHz/16bit/单声道 Int16 PCM（pcm-recorder 采集格式），
 * 浏览器原生不能直接播裸 PCM，加 44 字节标准 WAV 头即可（数据段原样直写，零拷贝转换）。
 * 调用方负责在播放结束/组件卸载时 URL.revokeObjectURL 回收。
 */

/** Int16 PCM（16kHz/16bit/单声道）→ WAV Blob URL；sampleRate 供非默认采样率扩展 */
export function pcmToWavUrl(pcm: ArrayBuffer, sampleRate = 16000): string {
  const dataLength = pcm.byteLength;
  // 44 字节头：RIFF(4+4) + WAVE(4) + fmt 块(4+16) + data 块头(4+4)
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true); // RIFF 块大小
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt 块长度（PCM 固定 16）
  view.setUint16(20, 1, true); // 格式 = PCM
  view.setUint16(22, 1, true); // 声道数 = 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate = sampleRate × 2（16bit 单声道）
  view.setUint16(32, 2, true); // blockAlign = 2
  view.setUint16(34, 16, true); // bitsPerSample
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);

  const blob = new Blob([header, pcm], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}
