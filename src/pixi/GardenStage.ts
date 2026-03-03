import * as PIXI from "pixi.js";

export class GardenStage {
  app: PIXI.Application;
  container: PIXI.Container;

  constructor(dom: HTMLDivElement) {
    this.app = new PIXI.Application({
      width: 600,
      height: 400,
      backgroundColor: 0xf4f1ec,
      antialias: true
    });

    dom.appendChild(this.app.view as HTMLCanvasElement);

    this.container = new PIXI.Container();
    //this.app.stage.addChild(this.container);
    this.app.stage.addChild(
      new PIXI.Graphics()
      .beginFill(0xdddddd)
      .drawRect(0, 0, 600, 400)
      .endFill()
     );
  }

  clear() {
    this.container.removeChildren();
  }
}