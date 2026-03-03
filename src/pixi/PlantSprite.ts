import * as PIXI from "pixi.js";

export function createPlant(
  texturePath: string,
  x: number,
  y: number
) {
  const texture = PIXI.Texture.from(texturePath);
  const sprite = new PIXI.Sprite(texture);

  // 以底部为锚点（非常重要）
  sprite.anchor.set(0.5, 1);

  // 透视：越靠后越小
  const scale = 1 - y * 0.04;
  sprite.scale.set(scale);

  sprite.x = x;
  sprite.y = y;

  return sprite;
}