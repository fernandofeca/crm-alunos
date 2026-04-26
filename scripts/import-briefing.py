"""
Reads Respostas briefing.xlsx and POSTs data to /api/alunos/briefing-import
Columns: A=Nome, C=DataNascimento, D=Cidade, E=Estado, F=Endereco, G=Email, H=Bio
Only updates existing CRM students (by email then name). No new records created.
"""
import json
import urllib.request
import urllib.error
import openpyxl
from datetime import datetime

XLSX_PATH = r"C:\Users\ferna\Downloads\Respostas briefing.xlsx"
API_URL = "https://cgmentoria.up.railway.app/api/alunos/briefing-import?key=cg-bulk-2026"
BATCH_SIZE = 100

wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
ws = wb.active

rows = []
seen_emails = set()
seen_names = set()

def normalize(s):
    import unicodedata
    s = str(s or "").strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().strip()

for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True)):
    nome = str(row[0] or "").strip()      # A
    dt_nasc_raw = row[2]                   # C
    cidade = str(row[3] or "").strip()     # D
    estado = str(row[4] or "").strip()     # E
    endereco = str(row[5] or "").strip()   # F
    email = str(row[6] or "").strip().lower()  # G
    bio = str(row[7] or "").strip()        # H

    if not nome and not email:
        continue

    # Parse date
    dt_nasc = None
    if dt_nasc_raw:
        if isinstance(dt_nasc_raw, datetime):
            dt_nasc = dt_nasc_raw.strftime("%Y-%m-%d")
        else:
            try:
                dt_nasc = str(dt_nasc_raw).strip()[:10]
            except Exception:
                dt_nasc = None

    # Deduplicate: prefer email, fallback name
    key = email if email else normalize(nome)
    if key in seen_emails:
        continue
    seen_emails.add(key)

    rows.append({
        "nome": nome,
        "email": email,
        "dataNascimento": dt_nasc,
        "cidade": cidade,
        "estado": estado,
        "endereco": endereco,
        "bio": bio,
    })

wb.close()
print(f"Total de linhas únicas a enviar: {len(rows)}")

# Send in batches
total_atualizados = 0
total_ignorados = 0
total_erros = []

for start in range(0, len(rows), BATCH_SIZE):
    batch = rows[start:start + BATCH_SIZE]
    body = json.dumps(batch).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            total_atualizados += result.get("atualizados", 0)
            total_ignorados += result.get("ignorados", 0)
            total_erros.extend(result.get("erros", []))
            print(f"  Lote {start//BATCH_SIZE + 1}: +{result.get('atualizados',0)} atualizados, {result.get('ignorados',0)} sem correspondência")
    except urllib.error.HTTPError as e:
        print(f"  Erro HTTP {e.code}: {e.read().decode()}")
    except Exception as e:
        print(f"  Erro: {e}")

print(f"\nResultado final:")
print(f"  Atualizados: {total_atualizados}")
print(f"  Sem correspondência (ignorados): {total_ignorados}")
if total_erros:
    print(f"  Erros ({len(total_erros)}):")
    for e in total_erros[:20]:
        print(f"    - {e}")
