import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

const USERSCRIPT_URL = "https://yamapez.github.io/easysmarky/easysmarky.user.js";

const USERSCRIPT_BANNER = `// ==UserScript==
// @name         easysmarky
// @namespace    https://github.com/yamapez/easysmarky
// @version      ${pkg.version}
// @description  Smarkyのレポート入力をフォームUIで楽にする(下書き保存まで。提出は行いません)
// @match        https://digi-repo.smarky.jp/*
// @grant        none
// @run-at       document-idle
// @noframes
// @updateURL    ${USERSCRIPT_URL}
// @downloadURL  ${USERSCRIPT_URL}
// ==/UserScript==
`;

// minify(esbuild)は通常コメントを落とすため、banner は minify 後に付与する
function userscriptBanner(): Plugin {
  return {
    name: "easysmarky:userscript-banner",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk") {
          chunk.code = USERSCRIPT_BANNER + chunk.code;
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const isUserscript = mode === "userscript";
  return {
    plugins: isUserscript ? [userscriptBanner()] : [],
    define: {
      __EASYSMARKY_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      lib: {
        entry: resolve(
          __dirname,
          isUserscript ? "src/userscript.ts" : "src/main.ts",
        ),
        name: "EasySmarky",
        formats: ["iife"],
        fileName: () => (isUserscript ? "easysmarky.user.js" : "easysmarky.iife.js"),
      },
      outDir: "dist",
      // userscript ビルドは iife ビルドの後に走るので dist を消さない
      emptyOutDir: !isUserscript,
      cssCodeSplit: false,
      minify: true,
    },
  };
});
