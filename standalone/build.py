"""Собирает из parts/ два файла:
korgan.html          - полный документ, открывается двойным щелчком, сервер не нужен;
korgan.artifact.html - то же без обёртки <html>, для публикации как артефакт Claude;
../index.html        - копия korgan.html в корне репозитория для GitHub Pages."""
from pathlib import Path
d = Path(__file__).parent
p = d / "parts"
head = (p / "head.html").read_text(encoding="utf-8")
body = (p / "body.html").read_text(encoding="utf-8")
eng = (p / "engine.js").read_text(encoding="utf-8")
ui = (p / "ui.js").read_text(encoding="utf-8")
frag = head + "\n" + body + "\n<script>\n" + eng + "\n</script>\n<script>\n" + ui + "\n</script>\n"
(d / "korgan.artifact.html").write_text(frag, encoding="utf-8")
full = '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + head + '\n</head>\n<body>\n' + \
       body + "\n<script>\n" + eng + "\n</script>\n<script>\n" + ui + "\n</script>\n</body>\n</html>\n"
full = full.replace(head, head, 1)
(d / "korgan.html").write_text(full, encoding="utf-8")
(d.parent / "index.html").write_text(full, encoding="utf-8")
print("ok", len(full), len(frag))
