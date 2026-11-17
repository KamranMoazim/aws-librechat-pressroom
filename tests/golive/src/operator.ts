import { createInterface } from 'node:readline/promises';

export interface Operator {
  interactive: boolean;
  confirm(instruction: string): Promise<boolean>;
  ask(question: string): Promise<string>;
}

export function terminalOperator(interactive: boolean): Operator {
  const prompt = async (text: string) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await rl.question(text)).trim();
    } finally {
      rl.close();
    }
  };
  return {
    interactive,
    async confirm(instruction) {
      if (!interactive) {
        return false;
      }
      const answer = await prompt(`\n>>> ${instruction}\n    Done? [y/N] `);
      return /^y(es)?$/i.test(answer);
    },
    async ask(question) {
      return interactive ? prompt(`\n>>> ${question} `) : '';
    },
  };
}
