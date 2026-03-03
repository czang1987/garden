import * as PIXI from 'pixi.js'

export async function createPixiApp(width: number, height: number) {
  const app=new PIXI.Application()
  
  await app.init({
    width,
    height,
    backgroundColor: 0xf4f4f4,
  })
  return app
}

