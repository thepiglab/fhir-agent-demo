// The model's status (app.model, mirrored from the model host by src/app/model-gate.ts).
import { useApp } from '../store.ts';
import type { ModelStatus } from '../../app/state.ts';

export function useModel(): ModelStatus {
  return useApp(['model', 'busy']).model;
}
