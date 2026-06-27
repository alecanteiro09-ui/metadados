# VideoClean 🎬

**Remova todos os metadados do seu vídeo diretamente no navegador.**

Vídeos baixados de outras contas (Facebook, Instagram, TikTok) carregam metadados que identificam a origem. Ao repostar esse conteúdo, plataformas detectam o arquivo como "reutilizado" e reduzem o alcance orgânico. O VideoClean remove todos esses dados e regera o arquivo do zero.

---

## ✨ O que ele faz

- Remove todos os metadados embutidos (título, data, localização, dispositivo, encoder, IDs)
- Re-encoda o vídeo com `libx264 + aac` — novo fingerprint, novo arquivo
- Limpa o nome do arquivo (remove hashes e timestamps de rastreamento)
- Aleatoriza o timestamp interno do container MP4
- Funciona 100% no navegador — **nenhum vídeo é enviado a servidores**

---

## 🚀 Como usar (GitHub Pages)

1. Fork este repositório
2. Vá em **Settings → Pages → Branch: main → / (root) → Save**
3. Acesse `https://seu-usuario.github.io/video-metadata-cleaner/`

### Uso local

```bash
git clone https://github.com/seu-usuario/video-metadata-cleaner
cd video-metadata-cleaner

# Servidor local simples (necessário por causa do SharedArrayBuffer)
npx serve .
# ou
python3 -m http.server 8080
```

> ⚠️ **Importante:** FFmpeg.wasm requer `SharedArrayBuffer`, que só funciona em contexto seguro (HTTPS ou localhost). GitHub Pages já serve via HTTPS, então funciona direto.

---

## 🛠️ Tecnologias

| Tecnologia | Uso |
|---|---|
| [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) | Processamento de vídeo no browser |
| HTML + CSS + JS puro | Interface, sem frameworks |
| GitHub Pages | Hospedagem gratuita |

---

## 📋 Metadados removidos

```
title, comment, description, author, artist, album
year, date, creation_time
location, latitude, longitude
make, model (dispositivo)
software, encoder, encoded_by
copyright, genre, track
major_brand, minor_version, compatible_brands
com.android.version, handler_name, vendor_id
```

Além dos metadados textuais, o re-encode com `-fflags +bitexact` remove o fingerprint do encoder original.

---

## ⚠️ Aviso

Esta ferramenta deve ser usada apenas em vídeos que você tem direito de editar e republicar. Não use para violar direitos autorais de terceiros.

---

## 📄 Licença

MIT
