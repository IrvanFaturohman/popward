import 'matter-js';

// Fields that exist on Matter 0.20 bodies but are missing from @types/matter-js.
declare module 'matter-js' {
  interface Body {
    positionPrev: Vector;
    anglePrev: number;
    deltaTime: number;
  }
  interface Collision {
    supports: Vector[];
    supportCount: number;
    tangent: Vector;
    parentA: Body;
    parentB: Body;
  }
}
