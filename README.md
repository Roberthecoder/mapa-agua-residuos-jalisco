# Agua y Residuos · Jalisco

Mapa vivo de los problemas hídricos y de residuos que enfrenta Jalisco, ordenados del más grave al más local.

**Qué incluye**

- 33 problemas georreferenciados (ríos, lagos, acuíferos, abasto, inundaciones, vertederos, residuos industriales y agrícolas), con gravedad de 1 a 5, municipios, afectados, situación actual y fuentes.
- **Noticias en vivo:** GitHub Actions ([`.github/workflows/actualizar.yml`](.github/workflows/actualizar.yml)) ejecuta `scripts/actualizar_noticias.py` cada 3 horas y guarda las notas de los últimos 30 días en `data/noticias.json`. La página revisa el archivo cada 10 minutos.
- **Lluvia en vivo** por punto (Open‑Meteo): actual, últimas 24 h y pronóstico de 24 h.
- **Fotos reales** de Wikimedia Commons (con autoría y licencia) y capa de satélite Esri.

## Editar o agregar problemas

Todo vive en [`data/problemas.json`](data/problemas.json). El orden del arreglo es el orden del ranking. Campos: `id`, `titulo`, `tipo` (`agua` | `residuos` | `ambos`), `gravedad` (1–5), `lat`, `lng`, `municipios`, `afectados`, `descripcion`, `estado`, `busqueda` (búsqueda de noticias), `fotoQuery` (búsqueda de fotos en Commons; `null` = solo satélite), `fotoTipo` (`problema` | `lugar`) y `fuentes`.

## Correr localmente

```bash
python -m http.server 8000
```

Abrir http://localhost:8000.

## Aviso

Las coordenadas son aproximadas y la gravedad es una valoración editorial basada en las fuentes enlazadas, no un dictamen oficial. Para datos oficiales: Conagua, CEA Jalisco, SIAPA, Semadet y Proepa.
