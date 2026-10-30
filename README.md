# Radiografía de nuestro sistema de salud

Visualización interactiva de los establecimientos, la accesibilidad y los recursos humanos del sistema de salud argentino.

## Vistas

- **Radiografía:** distribución geográfica de los establecimientos REFES.
- **Eco Doppler:** isócronas de viaje en auto, con selección de provincia, tipología y umbral.
- **Historia Clínica:** cobertura provincial de asentamientos BAHRA a 60 minutos para cualquier establecimiento y terapia intensiva, y a 30 minutos para guardia permanente; tasas de profesionales y cruces REFEPS de provincia de formación y residencia.
- **Derivación:** búsqueda de establecimientos cercanos y cálculo de rutas. Requiere configurar una clave de OpenRouteService en el entorno de Cloudflare Pages.

La cobertura cuenta asentamientos, no personas, y usa establecimientos con coordenadas válidas o recuperadas desde Healthsites. Los efectores sin ubicación utilizable no entran en el cálculo, por lo que la cobertura mostrada podría subestimar el acceso. Las isócronas son estimaciones de viaje en auto; no representan tiempos de respuesta de emergencias. El manifiesto tiene 6.425 de 6.425 lotes procesados; 146 establecimientos se omitieron por errores del servicio de rutas y figuran en el reporte.

Los profesionales activos se estiman con los grupos de 20 a 64 años inclusive. Las tasas usan población provincial del Censo 2022. La matriz REFEPS compara provincia de formación y residencia para registros con ambas provincias argentinas identificadas; residencia no indica dónde ejerce cada profesional.

## Fuentes

- [REFES — Registro Federal de Establecimientos de Salud](https://datos.salud.gob.ar/dataset/listado-establecimientos-de-salud-asentados-en-el-registro-federal-refes)
- [REFEPS — serie de medicina](https://datos.salud.gob.ar/dataset/serie-de-profesionales-de-medicina) y [serie de enfermería](https://datos.salud.gob.ar/dataset/serie-de-profesionales-de-enfermeria-auxiliarato-tecnicatura-y-licenciatura)
- [INDEC — Censo Nacional 2022 y marco geoestadístico](https://www.indec.gob.ar/indec/web/Nivel4-Tema-2-41-165)
- [BAHRA — Base de Asentamientos Humanos de la República Argentina](http://www.bahra.gob.ar/)
- [OpenStreetMap](https://www.openstreetmap.org/copyright) y [OpenRouteService](https://openrouteservice.org/)

## Datos de entrada

Colocá los insumos locales en estas rutas antes de ejecutar `npm run prepare-data`:

- `data/raw/refes-2023-updated.csv`: REFES actualizado el 2026-01-14; el nombre conserva el año de referencia analítica 2023.
- `data/raw/medicos-2023.csv` y `data/raw/enfermeria-2023.csv`: series REFEPS 2023.
- `poblacion_provincias_2022.csv`: población provincial del Censo 2022.
- `base_total.geojson/base_total.geojson`: BAHRA, recuperada el 2026-10-14.
- `radios_censales2/`: radios censales del marco geoestadístico INDEC, recuperados el 2026-10-14.

`npm run prepare-data` genera los datos estáticos en `public/data/`. Las isócronas se preparan por separado con `npm run generate-isochrones`; la opción `--assemble-only` utiliza la caché local existente y no consulta el servicio ORS. `npm run check-data` valida los artefactos publicados.

El código del proyecto se distribuye bajo MIT (ver [LICENSE](LICENSE)). Los datos fuente mantienen las condiciones de reutilización de sus respectivos organismos. Los datos fuente grandes no se publican aquí, salvo los CSV/XLSX documentados en `data/raw/`. Las coordenadas recuperadas de Healthsites conservan una marca de procedencia y no se presentan como verificación independiente; deben contrastarse con OpenStreetMap antes de usarse para decisiones operativas. La cartografía de OpenStreetMap se distribuye bajo ODbL.
