/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASEMAP_TILE_URL?: string;
  readonly VITE_BASEMAP_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
