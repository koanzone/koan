export type State = 'idle' | 'attention' | 'thinking' | 'talking' | 'amused';
export type Action = {type: 'focus' | 'blur' | 'submit' | 'delta' | 'finish' | 'amused' | 'settle'};
export function transition(state: State, action: Action): State {
 switch (action.type) {
  case 'focus': return state === 'idle' ? 'attention' : state;
  case 'blur': return state === 'attention' ? 'idle' : state;
  case 'submit': return 'thinking';
  case 'delta': return 'talking';
  case 'amused': return 'amused';
  case 'settle': return state === 'amused' ? 'idle' : state;
  case 'finish': return 'idle';
 }
}
