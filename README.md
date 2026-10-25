# DataCheck — Validador de calidad de archivos CSV

## 1. Problemática

**Contexto:** En actividades de análisis de datos se utilizan archivos CSV que deben revisarse antes de procesar su información.

**Problema:** Estos archivos pueden contener valores vacíos, registros duplicados o errores de formato. Revisarlos manualmente toma tiempo y puede ocasionar resultados incorrectos.

**Usuario objetivo:** Estudiantes, analistas de datos y personal administrativo que trabajan con archivos CSV.

## 2. Objetivo y solución propuesta

Desarrollar **DataCheck**, una aplicación web que permita revisar la calidad de archivos CSV de manera sencilla, identificando problemas en los datos y mostrando resultados que faciliten su revisión.

## 3. Funcionalidades principales

- Cargar archivos CSV o utilizar datos de ejemplo.
- Identificar valores vacíos y registros duplicados.
- Mostrar la cantidad de registros, columnas, valores vacíos y duplicados.
- Visualizar la completitud de los datos por columna.
- Filtrar registros para revisar los problemas detectados.
- Descargar un informe CSV con los resultados.
- Mostrar un mensaje de error y limpiar los resultados anteriores cuando se carga un CSV inválido.

## 4. Instrucciones de ejecución

**Desde GitHub Pages:** abrir la aplicación en:

https://adrianlsl.github.io/EB1---Inteligencia-Artificial/Datacheck/

**Desde Visual Studio Code:**

1. Descargar o clonar el repositorio.
2. Abrir la carpeta `Datacheck` en Visual Studio Code.
3. Abrir `index.html` con la extensión **Live Server**.
4. Cargar un archivo CSV o seleccionar **Usar datos de ejemplo**.

Para ejecutar las pruebas automatizadas, abrir una terminal en la carpeta `Datacheck` y ejecutar:

```bash
npm test
```

## 5. Uso de GitHub Copilot

GitHub Copilot se utilizó como apoyo para:

- **Analizar y explicar el código** de la aplicación e identificar posibles mejoras.
- **Implementar una corrección** en la carga de archivos CSV inválidos, mostrando un mensaje claro y eliminando los resultados del análisis anterior.
- **Revisar y comprobar el funcionamiento** mediante pruebas automatizadas.

**Decisiones tomadas:** Se mantuvo el diseño de la aplicación y se incorporó la corrección para evitar mostrar resultados anteriores después de una carga fallida. La modificación se comprobó con un CSV inválido y con la ejecución de **8 pruebas automatizadas aprobadas**.

Las capturas del trabajo realizado con Copilot se conservan en la carpeta `evidencias/`.

Workshop de referencia indicado en el examen: https://github-samples.github.io/copilot-workshops/first-steps/copilot-app/

## 6. Enlaces de entrega



https://github.com/adrianlsl/EB1---Inteligencia-Artificial Repositorio

https://adrianlsl.github.io/EB1---Inteligencia-Artificial/Datacheck/ Page
