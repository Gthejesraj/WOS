/**
 * Example WOS plugin.
 *
 * Drop this folder into ~/.wos/plugins/hello/ and restart WOS. The agent
 * will then have access to a `hello__greet` tool.
 *
 * The exported `register` function receives a small registration API
 * (`defineTool`, `logger`). Tools registered here become regular agent
 * tools, with the plugin id automatically prepended to their names.
 */

/** @typedef {import('../../../electron/main/plugins/types').PluginRegistrationApi} Api */

/** @param {Api} api */
function register(api) {
  api.logger.info('hello plugin loaded')

  api.defineTool({
    name: 'greet',
    description: 'Return a friendly greeting. Useful for verifying plugin loading works.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name to greet.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    async handler(input, ctx) {
      const name = (input && typeof input === 'object' && 'name' in input)
        ? String((/** @type {{name: unknown}} */ (input)).name)
        : 'world'
      ctx.log(`greeting ${name}`)
      return { output: `Hello, ${name}! (from the hello plugin)` }
    },
  })
}

module.exports = { register }
