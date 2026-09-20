# **Radiografía de nuestro sistema de salud**

## *Una mirada a las distancias, recursos y desigualdades que existen detrás del mapa sanitario argentino*

Visualización interactiva realizada para el concurso **Contar con Datos 2026** de la Universidad de San Andrés y la Secretaría de Ciencia, Tecnología e Innovación.

## Fuentes de datos

- https://datos.salud.gob.ar/dataset/listado-establecimientos-de-salud-asentados-en-el-registro-federal-refes
- http://www.bahra.gob.ar/
- https://www.indec.gob.ar/indec/web/Nivel4-Tema-1-17-184
- https://gather.healthsites.io/#country-data
- https://datos.salud.gob.ar/dataset/serie-de-profesionales-de-enfermeria-auxiliarato-tecnicatura-y-licenciatura
- https://datos.salud.gob.ar/dataset/serie-de-profesionales-de-medicina

## Exploración de datos

`exploratory_data_analysis.ipynb` carga cada archivo en una sección individual
con tipos explícitos, análisis de faltantes y outliers, conteos, agregaciones,
histogramas y mapas rápidos:

```bash
python -m pip install pandas openpyxl geopandas matplotlib seaborn jupyter
jupyter notebook exploratory_data_analysis.ipynb
```

El notebook aplica las definiciones de los PDFs en `docs/`, incluyendo la
interpretación de `total` en REFEPS, los códigos centinela de datos faltantes,
la validación de coordenadas de REFES y la reproyección de los radios censales
desde el CRS declarado por el archivo hacia EPSG:4326 para el análisis.
