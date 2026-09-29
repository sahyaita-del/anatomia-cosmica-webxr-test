# Señales — WebXR para Meta Quest 3S

Experiencia inmersiva de ~35 s (Three.js + WebXR). Todo se genera por código:
sin modelos, sin imágenes, sin fuentes externas. Se renderiza en el propio
Quest (standalone).

Necesitas **Node.js 18 o superior** → https://nodejs.org

---

## 1. Ejecutar el proyecto

```bash
npm install
npm run dev
```

La terminal mostrará dos direcciones, por ejemplo:

```
➜  Local:   https://localhost:5173/
➜  Network: https://192.168.1.34:5173/
```

## 2. Previsualizar en tu PC

1. Abre la dirección **Local** en Chrome o Edge.
2. El navegador avisará de que el certificado no es seguro (es un certificado
   local generado automáticamente). Pulsa **Configuración avanzada → Continuar**.
3. Pulsa **VISTA PREVIA**.
   - Arrastra con el ratón para mirar.
   - **W A S D** para moverte y notar la profundidad (paralaje).
   - **R** reinicia · **Esc** vuelve al menú.
   - Truco: añade `?t=20` a la URL para empezar en el segundo 20.

## 3. Hacerlo accesible desde el Meta Quest 3S

**Opción A — misma red Wi‑Fi (la más rápida)**

1. PC y Quest conectados a la **misma Wi‑Fi**.
2. Deja `npm run dev` en marcha.
3. Usa la dirección **Network** (`https://192.168.x.x:5173`).

> Si el Quest no la abre: permite Node.js en el firewall de Windows (red privada).

**Opción B — sin PC, con una URL pública (GitHub Pages)**

1. En GitHub: **Settings → Pages → Source: GitHub Actions**.
2. Fusiona esta rama en `main` (o lanza a mano el workflow *Deploy to GitHub Pages*).
3. La experiencia queda en
   `https://sahyaita-del.github.io/anatomia-cosmica-webxr-test/`

## 4. Abrirlo en Quest Browser y entrar en VR

1. Ponte el Quest y abre **Browser**.
2. Escribe la dirección (Opción A u Opción B).
3. Solo en la Opción A: aparece “La conexión no es privada” → **Avanzado → Continuar**.
4. Pulsa **ENTER VR** y acepta el permiso.
5. De pie, con un poco de espacio libre. La Tierra aparece delante de donde
   estés mirando al entrar. Para salir: botón **Meta** del mando.

---

## Estructura

```
index.html          pantalla de inicio (ENTER VR / VISTA PREVIA)
src/main.js         renderer, sesión WebXR, bucle y secuencia
src/timeline.js     tiempos de la narrativa (edítalos aquí)
src/stars.js        1.500 estrellas 3D reales (1 draw call)
src/earth.js        Tierra procedural (ruido 3D en shader) + atmósfera
src/wave.js         ondas electromagnéticas expansivas
src/text.js         tipografía espacial (canvas → textura)
```

Para generar la versión estática: `npm run build` (carpeta `dist/`).
