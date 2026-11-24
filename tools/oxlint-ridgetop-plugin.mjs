/** Custom oxlint JS plugin for Ridgetop-specific correctness & perf invariants. */
export default {
  meta: { name: 'ridgetop' },
  rules: {
    'no-math-spread': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow spreading arrays into Math.min / Math.max / Math.hypot (stack overflow & hot-loop allocation risk)'
        },
        messages: {
          avoid: 'Avoid spreading into Math.{{method}}(...); use an indexed loop or scalar arguments instead.'
        }
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee
            if (
              callee &&
              callee.type === 'MemberExpression' &&
              !callee.computed &&
              callee.object.type === 'Identifier' &&
              callee.object.name === 'Math' &&
              callee.property.type === 'Identifier' &&
              (callee.property.name === 'min' || callee.property.name === 'max' || callee.property.name === 'hypot')
            ) {
              for (const arg of node.arguments) {
                if (arg.type === 'SpreadElement') {
                  context.report({
                    node: arg,
                    messageId: 'avoid',
                    data: { method: callee.property.name }
                  })
                }
              }
            }
          }
        }
      }
    }
  }
}
