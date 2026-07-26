import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: {
		// 开发模式下把 API 请求转给本地 Argus 服务（npm run serve）
		proxy: {
			"/api": "http://127.0.0.1:8787",
		},
	},
});
