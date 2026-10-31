import { screenOutline } from './iphone-air.js';

// Proactive's Thinking2 layout uses a 400 × 880 logical screen.
export function updateContent(stage, opening) {
  const { width, height } = stage.getBoundingClientRect();
  if (!width || !height) return;
  const lift = height * opening / 100;
  const outline = screenOutline(width, height).map(([x, y]) => `${x.toFixed(4)}px ${(y - lift).toFixed(4)}px`);
  const main = document.getElementById('main-content');
  const ai = document.getElementById('ai-content');
  main.style.clipPath = `polygon(${outline.join(',')})`;
  // The same moving contour reveals AI content behind the white sheet.
  const outer = ['0px 0px', `${width}px 0px`, `${width}px ${height}px`, `0px ${height}px`, '0px 0px'];
  ai.style.clipPath = `polygon(evenodd, ${[...outer, ...outline, outline[0], outer[0]].join(',')})`;
  for (const layer of [main, ai]) layer.firstElementChild.style.transform = `scale(${width / 400}, ${height / 880})`;
  main.hidden = opening >= 100;
  ai.hidden = opening <= 0;
}
