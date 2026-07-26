import { createOverlay, type EasySmarkyController } from "./ui/overlay";

declare global {
  interface Window {
    __easysmarky?: EasySmarkyController;
  }
}

if (window.__easysmarky) {
  window.__easysmarky.toggle();
} else {
  window.__easysmarky = createOverlay();
  window.__easysmarky.start();
}
