# Radiografía de nuestro sistema de salud

Una visualización interactiva sobre la distribución territorial de los efectores y profesionales de salud en Argentina, la accesibilidad a establecimientos y la distancia desde una dirección.

## Estado

La aplicación interactiva y el proceso para preparar sus datos están en desarrollo. La primera vista utiliza REFES 2023 actualizado con las coordenadas Healthsites existentes en `data/raw/refes-2023-updated.csv`; no reintenta ni reemplaza esas coordenadas. El manifiesto de acceso contiene 6.425 de 6.425 lotes procesados y las áreas se ensamblan desde la caché reproducible; 146 establecimientos quedaron omitidos por errores de ORS y se detallan en el reporte. La búsqueda de direcciones y rutas requiere configurar una clave de OpenRouteService en el entorno de Cloudflare Pages.

Los profesionales activos se estiman sumando los grupos publicados hasta 60–64 años inclusive, según la metodología REFEPS. Las tasas por 1.000 usan población provincial del Censo 2022. Los porcentajes de acceso, cuando esté disponible la capa de isócronas, contarán asentamientos BAHRA y no personas.

## Fuentes

- [REFES — Registro Federal de Establecimientos de Salud](https://datos.salud.gob.ar/dataset/listado-establecimientos-de-salud-asentados-en-el-registro-federal-refes)
- [REFEPS — series de profesionales de medicina y enfermería](https://datos.salud.gob.ar/)
- [INDEC — Censo Nacional 2022](https://www.indec.gob.ar/indec/web/Nivel4-Tema-2-41-165)
- [BAHRA — Base de Asentamientos Humanos de la República Argentina](http://www.bahra.gob.ar/)
- [OpenStreetMap](https://www.openstreetmap.org/copyright) y [OpenRouteService](https://openrouteservice.org/)

## Datos de entrada

Colocá los insumos locales en estas rutas antes de ejecutar `npm run prepare-data`:

- `data/raw/refes-2023-updated.csv`: REFES, actualización 2026-01-14, fuente enlazada arriba; el año analítico se deriva del nombre `2023`.
- `data/raw/medicos-2023.csv` y `data/raw/enfermeria-2023.csv`: REFEPS 2023, descargados del portal de datos de Salud.
- `base_total.geojson/base_total.geojson`: BAHRA, descarga desde [bahra.gob.ar](http://www.bahra.gob.ar/), recuperada el 2026-10-14.
- `radios_censales2/`: radios censales del marco geoestadístico INDEC, descarga desde [INDEC](https://www.indec.gob.ar/indec/web/Nivel4-Tema-2-41-165), recuperada el 2026-10-14.

Los archivos fuente grandes permanecen fuera del control de versiones salvo los CSV/XLSX documentados en `data/raw/`. `npm run check-data` valida los artefactos publicados antes de desplegar.

Las coordenadas recuperadas de Healthsites se conservan con una marca de procedencia y no se presentan como verificación independiente; las posiciones deben contrastarse con OpenStreetMap antes de usarlas para decisiones operativas. La cartografía de OpenStreetMap se distribuye bajo ODbL; REFES, REFEPS, INDEC y BAHRA mantienen sus propias condiciones de reutilización.
