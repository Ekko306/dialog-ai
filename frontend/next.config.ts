import { withAui } from "@assistant-ui/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许局域网设备通过 192.168.1.117:3000 访问 dev 资源（含 HMR websocket），
  // 否则 Next 16 默认拦截非 localhost 来源，导致 ws://192.168.1.117:3000/_next/hmr 反复失败
  allowedDevOrigins: ["192.168.1.117"],
};

export default withAui(nextConfig);
