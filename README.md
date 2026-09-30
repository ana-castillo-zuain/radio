# Radiografía de nuestro sistema de salud

Una visualización interactiva sobre la distribución territorial de los efectores y profesionales de salud en Argentina, la accesibilidad a establecimientos y la distancia desde una dirección.

## Estado

La aplicación interactiva y el proceso para preparar sus datos están en desarrollo. La primera vista utiliza REFES 2023 actualizado con las coordenadas Healthsites existentes en `refes-2023-updated.csv`; no reintenta ni reemplaza esas coordenadas. Las áreas de isócrona permanecen vacías hasta incorporar y validar un procesamiento nacional sobre red vial. La búsqueda de direcciones y rutas requiere configurar una clave de OpenRouteService en el entorno de Cloudflare Pages.

Los profesionales activos se estiman sumando los grupos publicados hasta 60–64 años inclusive, según la metodología REFEPS. Las tasas por 1.000 usan población provincial del Censo 2022. Los porcentajes de acceso, cuando esté disponible la capa de isócronas, contarán asentamientos BAHRA y no personas.

## Preparar datos

Se necesita Python con `pandas`, `geopandas`, `pyogrio` y `shapely`, además de Node.js y npm.

```bash
python -m pip install pandas geopandas pyogrio shapely
npm install
npm run prepare-data
```

El proceso genera los archivos compactos de navegador en `public/data/`: efectores, provincias, asentamientos, métricas y un GeoJSON vacío para las futuras isócronas. Lee `poblacion_provincias_2022.csv` como fuente de los denominadores.

## Desarrollo local

```bash
npm run dev
```

La web carga desde `http://localhost:5173`. Para usar la búsqueda/ruteo local, crear `.dev.vars` con `ORS_API_KEY=...`, compilar la aplicación y ejecutar Pages Functions:

```bash
npm run build
npm run dev:pages
```

La vista de mapa utiliza teselas raster de OpenStreetMap y muestra su atribución. Se pueden cambiar en el build con `VITE_BASEMAP_TILE_URL` y `VITE_BASEMAP_ATTRIBUTION` para usar un proveedor con capacidad/SLA adecuados. El buscador consulta una dirección solo cuando el usuario envía el formulario; el ruteo compara hasta ocho efectores cercanos por tiempo mediante OpenRouteService.

## Publicar en Cloudflare Pages

- Conectar el repositorio de GitHub a Cloudflare Pages.
- Build command: `npm run build`.
- Output directory: `dist`.
- Agregar `ORS_API_KEY` como secreto de Functions en las variables de entorno del proyecto.
- Ejecutar `npm run prepare-data` y versionar `public/data/` antes de publicar para que el sitio incluya los datasets preparados.

Cloudflare Pages detecta `functions/api/search.ts` y publica el endpoint `/api/search`. La clave de rutas solo se lee del entorno del servidor.

## Contrato para las isócronas

`public/data/access-isochrones.geojson` debe contener superficies reales derivadas de tiempos de viaje por red vial, con estas propiedades por feature:

| Propiedad | Uso |
| --- | --- |
| `province_id` | Código INDEC de dos dígitos |
| `category` | Nombre de la tipología REFES |
| `threshold` | Umbral de viaje en minutos: 10, 20, 30 o 60 |
| `band` | Banda ordinal de menor a mayor tiempo: 0, 1, 2 o 3 |

El navegador filtra las áreas por provincia, tipología y umbral. La medición de asentamientos usa inclusión punto-en-polígono y no supone que una distancia recta represente un tiempo de ruta.

## Fuentes

- [REFES — Registro Federal de Establecimientos de Salud](https://datos.salud.gob.ar/dataset/listado-establecimientos-de-salud-asentados-en-el-registro-federal-refes)
- [REFEPS — series de profesionales de medicina y enfermería](https://datos.salud.gob.ar/)
- [INDEC — Censo Nacional 2022](https://www.indec.gob.ar/indec/web/Nivel4-Tema-2-41-165)
- [BAHRA — Base de Asentamientos Humanos de la República Argentina](http://www.bahra.gob.ar/)
- [OpenStreetMap](https://www.openstreetmap.org/copyright) y [OpenRouteService](https://openrouteservice.org/)
