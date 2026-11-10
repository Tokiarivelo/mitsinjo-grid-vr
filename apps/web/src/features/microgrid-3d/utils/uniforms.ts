import type * as THREE from 'three';

/**
 * Sets a shader uniform's value. Uniform objects are memoised once and then mutated (render loop,
 * layout effects): going through a call keeps that mutation out of React's render analysis.
 */
export function setUniformValue<T>(uniform: THREE.IUniform<T> | undefined, value: T): void {
  if (uniform) uniform.value = value;
}
