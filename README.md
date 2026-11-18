# LinkedIn Auto-Connect Chrome Extension

A Chrome extension for reviewing LinkedIn people-search results and My Network suggestions. Configure profile keywords and a connection or extraction limit in the popup.

> Independent community project. Not affiliated with, endorsed by, or sponsored by LinkedIn.

Developed by [Sebastián Bocek](https://github.com/sebastianbocek).

## How to use

1. Open a LinkedIn **People** search in the tab you want to process. For example: [B2B AI people search](https://www.linkedin.com/search/results/people/?keywords=b2b%20ai&origin=CLUSTER_EXPANSION). The search URL sets the result set; the extension keywords filter the profiles it processes.
2. Open the **LinkedIn Auto-Connect** extension and add the keywords to look for in the headline shown directly below each person's name.
3. Set the maximum number of connections or profiles to extract. Enter `0` for unlimited processing.
4. Choose how many profile tabs can be enriched at once (default: `5`). For each matching profile, the extension opens the profile in a background tab, clicks **Contact info** on that profile, reads available email and website links, and closes the tab. Emails are saved only when they have a valid email format. If Contact info contains multiple websites, they are all saved in the same CSV field, separated by semicolons. When the search tab is active, it waits for that page's enrichment work before advancing. If you switch away and the popup closes, scanning can continue with enrichment queued; reopen the extension to resume queued profiles. Fields remain blank when the member has not made that information available.
5. Leave **No conectar, solo extraer** unchecked to connect with matching profiles and collect them in the CSV. Turn it on to collect profiles without sending invitations.
6. Click **Iniciar**. The extension processes the results and advances to the next page when needed.
7. Click **Descargar CSV** after profile enrichment finishes to save the collected profile data.

You can also use the extension on LinkedIn **My Network → Grow** suggestions.

## Download and install

[⬇ **Download the extension (ZIP)**](https://github.com/sebastianbocek/linkedin-auto-connect-chrome-extension/archive/refs/heads/main.zip)

1. Download and extract the ZIP file.
2. Open `chrome://extensions/` in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.

## Preview

![LinkedIn Auto-Connect popup with configurable keywords, CSV export, and activity log](assets/extension-preview.png)

## Features

- Add and remove profile keywords in the popup. Matching is case-insensitive and accepts a keyword within a longer phrase, such as `B2B` in `B2B Outbound`.
- Checks the profile headline shown directly below the person's name in each result card.
- Calibrates supplied and automatically discovered selectors against each page before scanning. The activity log shows the selectors that match the current LinkedIn layout.
- Clicks **Connect** only. Profiles marked **Pending**, **Follow**, or **Message** are logged and skipped.
- If LinkedIn asks whether to add a note, selects **Send without a note** and continues.
- Scrolls through people-search results and advances to the next page when the current results are exhausted.
- Matching profiles are collected for CSV export by default. Columns are name, headline, location, LinkedIn URL, contact status, current company, contact email, and contact website. The extension opens each profile in a background tab and reads the email and all website links shown in **Contact info**. It accepts an email only if it has a valid email format, and stores multiple websites separated by semicolons in the same field. It closes the profile tab after extraction, even if a field is unavailable or reading fails. Configure up to 20 concurrent tabs (default: 5). Pagination waits for enrichment while the search tab is active; queued enrichment resumes when the popup is reopened after a tab switch.
- The **No conectar, solo extraer** mode does not send connection invitations and counts extracted profiles toward the configured limit.
- View and copy the activity log from the popup.
- Stops when LinkedIn displays its weekly connection invitation limit.

## Privacy and permissions

The extension uses `activeTab`, `scripting`, `tabs`, and LinkedIn host access to open and close background profile tabs for enrichment, and `storage` to remember popup settings. Matching profile data, including email and website when visible in Contact info, is collected from LinkedIn and downloaded locally when you request the CSV; the extension does not upload it to a server.

## Important

This tool automates actions on LinkedIn. Review your configuration and use it thoughtfully. LinkedIn may change its interface, which can affect how profile cards and controls are detected.

## Español

### Cómo usar

1. Abre en la pestaña de Chrome una búsqueda de personas de LinkedIn. Por ejemplo: [búsqueda de personas B2B AI](https://www.linkedin.com/search/results/people/?keywords=b2b%20ai&origin=CLUSTER_EXPANSION). La URL determina los resultados; las keywords de la extensión filtran los perfiles que procesará.
2. Abre la extensión **LinkedIn Auto-Connect** y agrega las keywords que quieras buscar en el titular que aparece justo debajo del nombre de cada perfil.
3. Define el máximo de conexiones o perfiles para extraer. Escribe `0` para continuar sin límite.
4. Define cuántas pestañas de perfil se pueden enriquecer a la vez (por defecto: `5`). Para cada perfil coincidente, la extensión abre el perfil en segundo plano, pulsa **Contact info**, lee los emails válidos y todos los websites disponibles y cierra la pestaña. Solo guarda emails con formato válido; si hay varios websites, los separa con punto y coma en el mismo campo del CSV. No fuerza la URL del overlay de LinkedIn. Con la búsqueda activa, espera a que se complete el enriquecimiento de esa página antes de avanzar. Si cambias de pestaña y se cierra el popup, el escaneo puede continuar y deja el enriquecimiento en cola; vuelve a abrir la extensión para reanudarlo. Los campos quedan vacíos si el perfil no publicó esa información.
5. Deja desmarcada **No conectar, solo extraer** para conectar con perfiles coincidentes y recopilar sus datos en el CSV. Actívala para extraer perfiles sin enviar invitaciones.
6. Pulsa **Iniciar**. La extensión procesa los resultados y avanza a la página siguiente cuando corresponde.
7. Pulsa **Descargar CSV** cuando termine el enriquecimiento para guardar los datos recopilados.

También puedes usar la extensión en las sugerencias de **My Network → Grow** de LinkedIn.

### Instalación

1. [Descarga el ZIP](https://github.com/sebastianbocek/linkedin-auto-connect-chrome-extension/archive/refs/heads/main.zip) y descomprímelo.
2. Abre `chrome://extensions/` y activa el **Modo desarrollador**.
3. Pulsa **Cargar descomprimida** y selecciona la carpeta que contiene `manifest.json`.

### Funciones

- Agrega o quita keywords desde la interfaz. La coincidencia no distingue mayúsculas y acepta una keyword dentro de una frase más larga, por ejemplo `B2B` en `B2B Outbound`.
- Busca las keywords en el titular que aparece debajo del nombre de cada ficha.
- Calibra antes de cada página los selectores compartidos y los que detecta automáticamente; el registro muestra cuáles coinciden con el diseño actual de LinkedIn.
- Pulsa únicamente **Connect**. Registra y omite perfiles con estado **Pending**, **Follow** o **Message**.
- Si LinkedIn pregunta si quieres agregar una nota, pulsa **Send without a note** y continúa.
- Exporta nombre, titular, ubicación, enlace de LinkedIn, estado de contacto, empresa actual, email de contacto y website de contacto al CSV. Abre el perfil en segundo plano y lee los emails válidos y todos los websites que aparecen en **Contact info**. Solo acepta emails con formato válido; si hay varios websites, los guarda juntos separados por punto y coma. La pestaña se cierra después de la extracción, aunque falte un dato o se produzca un error. Puedes configurar hasta 20 pestañas simultáneas (por defecto: 5). Con la búsqueda activa espera a que termine el enriquecimiento antes de paginar; si el popup se cierra al cambiar de pestaña, deja las tareas en cola y las reanuda al abrirlo de nuevo.
- Muestra contadores de conexiones, emails y websites obtenidos en la interfaz.
- Muestra un registro de actividad que puedes copiar desde la interfaz.
- Se detiene si LinkedIn muestra el límite semanal de invitaciones.

La extensión usa `activeTab`, `scripting`, `tabs` y acceso a LinkedIn para abrir y cerrar pestañas de perfil en segundo plano, además de `storage` para recordar la configuración. Recopila los datos coincidentes, incluidos email y website cuando aparecen en Contact info, y los descarga localmente; no los sube a un servidor.
