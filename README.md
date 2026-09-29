# La Tierra y el Sol — WebXR para Meta Quest 3S

Experiencia inmersiva de ~85 s para **sentir** la diferencia de tamaño entre la
Tierra y el Sol. Sin textos ni interfaz dentro de la experiencia.

**Escala:** radio del Sol = 109 × radio de la Tierra (`src/main.js`, `R_SUN`).
En la composición final la Tierra y el centro del Sol están a la misma
distancia del espectador, así que su tamaño aparente respeta la proporción
real (~62° frente a ~0,55°). Solo se comprime la distancia entre ambos.

Necesitas **Node.js 18+**.

## Ejecutar y previsualizar en el PC

```bash
npm install
npm run dev
```

Abre `https://localhost:5173` (acepta el aviso del certificado) → **VISTA PREVIA**.

- Ratón: arrastrar para mirar · **W A S D** moverse · **Espacio** play/pausa · **R** reiniciar · **Esc** menú
- Panel inferior (solo escritorio, nunca en VR): Play/Pausa, Reiniciar,
  línea de tiempo 0–85 s, tiempo actual, FPS y saltos a 20/30/35/45/60/75 s.
- Atajo: `https://localhost:5173/?t=45` abre la vista previa en el segundo 45.

## Meta Quest 3S

1. PC y Quest en la misma Wi‑Fi, con `npm run dev` en marcha.
2. En Quest Browser abre la dirección **Network** (`https://192.168.x.x:5173`).
3. “La conexión no es privada” → **Avanzado → Continuar**.
4. **ENTER VR**. De pie; la escena se orienta hacia donde mires al entrar.

(Alternativa sin PC: GitHub Pages, ver `.github/workflows/deploy.yml`.)

## Música

Coloca los dos archivos finales en `public/audio/` con estos nombres
(formato `.mp3`, `.m4a` u `.ogg`):

| Archivo | Pieza | Empieza | Fundidos |
|---|---|---|---|
| `tierra.mp3` | Tierra (íntima, ~30 s) | 0 s | entra 0–3 s · sale 27–32 s |
| `sol.mp3` | Sol (monumental, ~55 s) | 27 s | entra 27–32 s · sale 78–85 s |

El crossfade es de potencia constante. La línea de tiempo manda: al pausar,
saltar o reiniciar, la música se resincroniza sola. Tiempos editables en
`src/timeline.js` → `AUDIO`. Sin archivos, la experiencia funciona en silencio.

## Coreografía (`src/timeline.js`)

| Segundos | Qué ocurre |
|---|---|
| 0–6 | negro → espacio profundo |
| 5–25 | la Tierra, sola, cerca (~12° de ancho) |
| 25–34 | la Tierra se aleja y se desplaza; el espacio se abre |
| 31,5–40 | presencia del Sol: luz coronal; su silueta oscura tapa las estrellas |
| 35–45,5 | la fotosfera “amanece” desde el borde cercano a la Tierra |
| 45–70 | contemplación: Tierra + Sol a escala real |
| 70–85 | se apaga el espacio, luego el Sol y, por último, la Tierra |

## Estructura

```
src/main.js      escala, composición, WebXR, bucle
src/timeline.js  tiempos de la narrativa y del audio
src/earth.js     Tierra: Blue Marble, luces nocturnas, océano, nubes procedurales, atmósfera
src/sun.js       Sol: volumen de ruido 3D, fotosfera, corona, protuberancias
src/space.js     cielo horneado una vez en un cubemap + estrellas 3D
src/audio.js     sistema de dos pistas sincronizado con la línea de tiempo
src/devpanel.js  panel de desarrollo (solo escritorio)
public/textures  texturas de la Tierra (derivadas de NASA; confirmar licencia antes de publicar)
public/audio     aquí van las dos piezas musicales
```
