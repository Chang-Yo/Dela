import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type TodoPreferences = { showCompleted: boolean };

export const useTodoPreferences = create<TodoPreferences>()(
  persist((): TodoPreferences => ({ showCompleted: true }), {
    name: 'dela.todo.preferences',
    version: 1,
  }),
);
