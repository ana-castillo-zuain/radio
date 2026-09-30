# Radiografía de nuestro sistema de salud

Una visualización interactiva sobre la distribución territorial de los efectores y profesionales de salud en Argentina, la accesibilidad a establecimientos y la distancia desde una dirección.

## Estado

La aplicación interactiva y el proceso para preparar sus datos están en desarrollo. La primera vista utiliza REFES 2023 actualizado con las coordenadas Healthsites existentes en `refes-2023-updated.csv`; no reintenta ni reemplaza esas coordenadas. Las áreas de isócrona permanecen vacías hasta incorporar y validar un procesamiento nacional sobre red vial. La búsqueda de direcciones y rutas requiere configurar una clave de OpenRouteService en el entorno de Cloudflare Pages.

Los profesionales activos se estiman sumando los grupos publicados hasta 60–64 años inclusive, según la metodología REFEPS. Las tasas por 1.000 usan población provincial del Censo 2022. Los porcentajes de acceso, cuando esté disponible la capa de isócronas, contarán asentamientos BAHRA y no personas.

## Fuentes

- [REFES — Registro Federal de Establecimientos de Salud](https://datos.salud.gob.ar/dataset/listado-establecimientos-de-salud-asentados-en-el-registro-federal-refes)
- [REFEPS — series de profesionales de medicina y enfermería](https://datos.salud.gob.ar/)
- [INDEC — Censo Nacional 2022](https://www.indec.gob.ar/indec/web/Nivel4-Tema-2-41-165)
- [BAHRA — Base de Asentamientos Humanos de la República Argentina](http://www.bahra.gob.ar/)
- [OpenStreetMap](https://www.openstreetmap.org/copyright) y [OpenRouteService](https://openrouteservice.org/)
