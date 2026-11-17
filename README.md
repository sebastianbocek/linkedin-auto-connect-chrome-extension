# LinkedIn Auto-Connect Chrome Extension

A Chrome extension for reviewing LinkedIn people-search results and My Network suggestions. Configure profile keywords and a connection or extraction limit in the popup.

> Independent community project. Not affiliated with, endorsed by, or sponsored by LinkedIn.

Developed by [Sebastián Bocek](https://github.com/sebastianbocek).

## Download and install

[⬇ **Download the extension (ZIP)**](https://github.com/sebastianbocek/linkedin-auto-connect-chrome-extension/archive/refs/heads/main.zip)

1. Download and extract the ZIP file.
2. Open `chrome://extensions/` in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Open LinkedIn people-search results or **My Network → Grow**, open the extension, configure keywords and the action limit, then click **Iniciar**.

## Preview

![LinkedIn Auto-Connect popup with configurable keywords, CSV export, and activity log](assets/extension-preview.png)

## Features

- Add and remove profile keywords in the popup. Matching is case-insensitive and accepts a keyword within a longer phrase, such as `B2B` in `B2B Outbound`.
- Checks the profile headline, title, and current-position text in each result card.
- Clicks **Connect** only. Profiles marked **Pending**, **Follow**, or **Message** are logged and skipped.
- If LinkedIn asks whether to add a note, selects **Send without a note** and continues.
- Scrolls through people-search results and advances to the next page when the current results are exhausted.
- Matching profile names, categories, locations, and LinkedIn links are collected for CSV export by default.
- Enable **No conectar, solo extraer** to collect profiles without sending connection invitations. The configured limit then counts extracted profiles.
- Set a maximum number of connections or extracted profiles; enter `0` for unlimited processing.
- View and copy the activity log from the popup.
- Stops when LinkedIn displays its weekly connection invitation limit.

## Privacy and permissions

The extension uses `activeTab` and `scripting` to interact with the LinkedIn tab after you start it, and `storage` to remember your popup settings. Matching profile data is collected from LinkedIn result cards and downloaded locally when you request the CSV; the extension does not upload it to a server.

## Important

This tool automates actions on LinkedIn. Review your configuration and use it thoughtfully. LinkedIn may change its interface, which can affect how profile cards and controls are detected.

## Español

Extensión de Chrome para revisar resultados de búsqueda de personas y sugerencias de LinkedIn. Configura keywords en la ventana de la extensión y elige un límite de acciones.

- Agrega o quita keywords desde la interfaz. La coincidencia no distingue mayúsculas y acepta una keyword dentro de una frase más larga, por ejemplo `B2B` en `B2B Outbound`.
- Busca en el titular, cargo y puesto actual de cada ficha.
- Pulsa únicamente **Connect**. Registra y omite perfiles con estado **Pending**, **Follow** o **Message**.
- Si LinkedIn pregunta si quieres agregar una nota, pulsa **Send without a note** y continúa.
- Desplaza los resultados y avanza a la página siguiente al terminar la actual.
- Recopila nombre, categoría, ubicación y enlace de perfiles coincidentes para exportarlos a CSV.
- Activa **No conectar, solo extraer** para no enviar invitaciones. En ese modo, el límite cuenta perfiles extraídos.
- Define un máximo de conexiones o perfiles extraídos; `0` significa ilimitado.
- Muestra un registro de actividad que puedes copiar desde la interfaz.
- Se detiene si LinkedIn muestra el límite semanal de invitaciones.

La extensión usa `activeTab`, `scripting` y `storage`. Los datos del CSV se descargan localmente; no se suben a un servidor.
