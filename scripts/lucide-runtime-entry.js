import { createIcons, icons } from "lucide";

// Keep the existing window.lucide.createIcons() integration intact while
// shipping the pinned icon runtime inside the APK instead of fetching a CDN.
window.lucide = {
  createIcons() {
    return createIcons({ icons });
  },
};
