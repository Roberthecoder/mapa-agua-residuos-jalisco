"""Descarga noticias recientes (Google News RSS) para cada problema del mapa
y las guarda en data/noticias.json. Solo usa la biblioteca estándar.

Uso: python scripts/actualizar_noticias.py
"""
import json
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PROBLEMAS = RAIZ / "data" / "problemas.json"
SALIDA = RAIZ / "data" / "noticias.json"

GENERALES = [
    "Jalisco agua contaminación",
    "Jalisco residuos basura vertedero",
    "Guadalajara agua SIAPA",
    "Jalisco sequía presas nivel",
]


def rss(query, maximo=6):
    q = urllib.parse.quote(f"{query} when:30d")
    url = f"https://news.google.com/rss/search?q={q}&hl=es-419&gl=MX&ceid=MX:es-419"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (mapa-hidrico-jalisco)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raiz = ET.fromstring(r.read())
    except Exception as e:  # red caída, bloqueo temporal, etc.
        print(f"  ! {query}: {e}")
        return []
    items = []
    for it in list(raiz.iter("item"))[:maximo]:
        titulo = (it.findtext("title") or "").strip()
        fuente = (it.findtext("source") or "").strip()
        if fuente and titulo.endswith(" - " + fuente):
            titulo = titulo[: -len(fuente) - 3]
        try:
            fecha = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc).isoformat()
        except Exception:
            fecha = None
        items.append({"titulo": titulo, "url": it.findtext("link"), "fuente": fuente, "fecha": fecha})
    return items


def main():
    datos = json.loads(PROBLEMAS.read_text(encoding="utf-8"))
    por_problema = {}
    for p in datos["problemas"]:
        print("·", p["id"])
        notas = rss(p["busqueda"], 5)
        if not notas:  # búsqueda más amplia si la específica no trae nada
            time.sleep(1)
            notas = rss(" ".join(p["busqueda"].split()[:3]) + " Jalisco", 5)
        por_problema[p["id"]] = notas
        time.sleep(1)
    generales = []
    vistos = set()
    for q in GENERALES:
        for n in rss(q, 10):
            if n["url"] not in vistos:
                vistos.add(n["url"])
                generales.append(n)
        time.sleep(1)
    generales.sort(key=lambda n: n["fecha"] or "", reverse=True)
    salida = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generales": generales[:40],
        "por_problema": por_problema,
    }
    SALIDA.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(v) for v in por_problema.values())
    print(f"OK: {len(generales)} generales, {total} por problema")


if __name__ == "__main__":
    main()
