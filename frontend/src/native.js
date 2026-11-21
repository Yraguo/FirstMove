// 原生外壳（Android 应用）注入的能力。浏览器里 window.FirstMove 不存在，
// 下面每个函数都会退回浏览器原有做法，网页版与桌面端行为不变。

const bridge = typeof window !== "undefined" ? window.FirstMove : null;

export const isNativeApp = !!bridge;

export function nativeNotify(title, body) {
  if (!bridge || typeof bridge.notify !== "function") return false;
  try {
    bridge.notify(title, body);
    return true;
  } catch {
    return false;
  }
}

// 复制文本。原生外壳走系统剪贴板，其余环境退回 execCommand。
export function copyText(text) {
  if (bridge && typeof bridge.copy === "function") {
    try {
      bridge.copy(text);
      return true;
    } catch {
      // 落回浏览器路径
    }
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    document.body.removeChild(area);
    return done;
  } catch {
    return false;
  }
}

// 把 Blob 写入系统「下载」目录。返回 null 表示没有原生外壳，调用方继续走浏览器下载。
// 有原生外壳时返回一句可直接展示的结果文案。
export async function saveBlobToDevice(name, blob) {
  if (!bridge || typeof bridge.beginSave !== "function") return null;
  if (!bridge.beginSave(name)) return "无法创建下载文件";
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const step = 96 * 1024;
    for (let offset = 0; offset < bytes.length; offset += step) {
      const part = bytes.subarray(offset, Math.min(offset + step, bytes.length));
      let text = "";
      for (let i = 0; i < part.length; i += 0x8000) {
        text += String.fromCharCode.apply(null, part.subarray(i, Math.min(i + 0x8000, part.length)));
      }
      if (!bridge.appendChunk(btoa(text))) {
        bridge.cancelSave();
        return "写入文件失败";
      }
    }
    return bridge.endSave() || "已保存";
  } catch (error) {
    try {
      bridge.cancelSave();
    } catch {
      // 忽略二次失败
    }
    return error.message || "保存失败";
  }
}
