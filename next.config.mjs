import { fileURLToPath } from "node:url";

const nextConfig = {
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  output: "export",
  trailingSlash: true,
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
