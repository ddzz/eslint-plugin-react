/**
 * @fileoverview Enforce consistent usage of destructuring assignment of props, state, and context.
 */

'use strict';

const Components = require('../util/Components');
const docsUrl = require('../util/docsUrl');
const isAssignmentLHS = require('../util/ast').isAssignmentLHS;
const report = require('../util/report');
const testReactVersion = require('../util/version').testReactVersion;

const DEFAULT_OPTION = 'always';

function createSFCParams() {
  const queue = [];

  return {
    push(params) {
      queue.unshift(params);
    },
    pop() {
      queue.shift();
    },
    propsName() {
      const found = queue.find((params) => {
        const props = params[0];
        return props && !props.destructuring && props.name;
      });
      return found && found[0] && found[0].name;
    },
    contextName() {
      const found = queue.find((params) => {
        const context = params[1];
        return context && !context.destructuring && context.name;
      });
      return found && found[1] && found[1].name;
    },
  };
}

function evalParams(params) {
  return params.map((param) => ({
    destructuring: param.type === 'ObjectPattern',
    name: param.type === 'Identifier' && param.name,
  }));
}

const messages = {
  noDestructPropsInSFCArg: 'Must never use destructuring props assignment in SFC argument',
  noDestructContextInSFCArg: 'Must never use destructuring context assignment in SFC argument',
  noDestructAssignment: 'Must never use destructuring {{type}} assignment',
  useDestructAssignment: 'Must use destructuring {{type}} assignment',
  destructureInSignature: 'Must destructure props in the function signature.',
};

module.exports = {
  meta: {
    docs: {
      description: 'Enforce consistent usage of destructuring assignment of props, state, and context',
      category: 'Stylistic Issues',
      recommended: false,
      url: docsUrl('destructuring-assignment'),
    },
    fixable: 'code',
    messages,

    schema: [{
      type: 'string',
      enum: [
        'always',
        'never',
      ],
    }, {
      type: 'object',
      properties: {
        ignoreClassFields: {
          type: 'boolean',
        },
        destructureInSignature: {
          type: 'string',
          enum: [
            'always',
            'ignore',
          ],
        },
      },
      additionalProperties: false,
    }],
  },

  create: Components.detect((context, components, utils) => {
    const configuration = context.options[0] || DEFAULT_OPTION;
    const ignoreClassFields = (context.options[1] && (context.options[1].ignoreClassFields === true)) || false;
    const destructureInSignature = (context.options[1] && context.options[1].destructureInSignature) || 'ignore';
    const sfcParams = createSFCParams();

    // set to save renamed var of useContext
    const contextSet = new Set();
    /**
     * @param {ASTNode} node We expect either an ArrowFunctionExpression,
     *   FunctionDeclaration, or FunctionExpression
     */
    function handleStatelessComponent(node) {
      const params = evalParams(node.params);

      const SFCComponent = components.get(context.getScope(node).block);
      if (!SFCComponent) {
        return;
      }
      sfcParams.push(params);

      if (params[0] && params[0].destructuring && components.get(node) && configuration === 'never') {
        report(context, messages.noDestructPropsInSFCArg, 'noDestructPropsInSFCArg', {
          node,
        });
      } else if (params[1] && params[1].destructuring && components.get(node) && configuration === 'never') {
        report(context, messages.noDestructContextInSFCArg, 'noDestructContextInSFCArg', {
          node,
        });
      }
    }

    function handleStatelessComponentExit(node) {
      const SFCComponent = components.get(context.getScope(node).block);
      if (SFCComponent) {
        sfcParams.pop();
      }
    }

    function handleSFCUsage(node) {
      const propsName = sfcParams.propsName();
      const contextName = sfcParams.contextName();
      // props.aProp
      const isPropUsed = (
        (propsName && node.object.name === propsName)
          || (contextName && node.object.name === contextName)
      )
        && !isAssignmentLHS(node);
      if (isPropUsed && configuration === 'always') {
        report(context, messages.useDestructAssignment, 'useDestructAssignment', {
          node,
          data: {
            type: node.object.name,
          },
        });
      }

      // const foo = useContext(aContext);
      // foo.aProp
      const isContextUsed = contextSet.has(node.object.name) && !isAssignmentLHS(node);
      if (isContextUsed && configuration === 'always') {
        context.report({
          node,
          message: `Must use destructuring ${node.object.name} assignment`,
        });
      }
    }

    function isInClassProperty(node) {
      let curNode = node.parent;
      while (curNode) {
        if (curNode.type === 'ClassProperty' || curNode.type === 'PropertyDefinition') {
          return true;
        }
        curNode = curNode.parent;
      }
      return false;
    }

    function handleClassUsage(node) {
      // this.props.Aprop || this.context.aProp || this.state.aState
      const isPropUsed = (
        node.object.type === 'MemberExpression' && node.object.object.type === 'ThisExpression'
        && (node.object.property.name === 'props' || node.object.property.name === 'context' || node.object.property.name === 'state')
        && !isAssignmentLHS(node)
      );

      if (
        isPropUsed && configuration === 'always'
        && !(ignoreClassFields && isInClassProperty(node))
      ) {
        report(context, messages.useDestructAssignment, 'useDestructAssignment', {
          node,
          data: {
            type: node.object.property.name,
          },
        });
      }
    }

    const hasHooks = testReactVersion(context, '>= 16.9');

    return {
      FunctionDeclaration: handleStatelessComponent,

      ArrowFunctionExpression: handleStatelessComponent,

      FunctionExpression: handleStatelessComponent,

      'FunctionDeclaration:exit': handleStatelessComponentExit,

      'ArrowFunctionExpression:exit': handleStatelessComponentExit,

      'FunctionExpression:exit': handleStatelessComponentExit,

      MemberExpression(node) {
        let scope = context.getScope(node);
        let SFCComponent = components.get(scope.block);
        while (!SFCComponent && scope.upper && scope.upper !== scope) {
          SFCComponent = components.get(scope.upper.block);
          scope = scope.upper;
        }
        if (SFCComponent) {
          handleSFCUsage(node);
        }

        const classComponent = utils.getParentComponent(node);
        if (classComponent) {
          handleClassUsage(node);
        }
      },

      VariableDeclarator(node) {
        const classComponent = utils.getParentComponent(node);
        const SFCComponent = components.get(context.getScope(node).block);

        const destructuring = (node.init && node.id && node.id.type === 'ObjectPattern');
        const identifier = (node.init && node.id && node.id.type === 'Identifier');
        // let {foo} = props;
        const destructuringSFC = destructuring && node.init.name === 'props';
        // let {foo} = useContext(aContext);
        const destructuringUseContext = hasHooks && destructuring && node.init.callee && node.init.callee.name === 'useContext';
        // let foo = useContext(aContext);
        const assignUseContext = hasHooks && identifier && node.init.callee && node.init.callee.name === 'useContext';
        // let {foo} = this.props;
        const destructuringClass = destructuring && node.init.object && node.init.object.type === 'ThisExpression' && (
          node.init.property.name === 'props' || node.init.property.name === 'context' || node.init.property.name === 'state'
        );

        if (SFCComponent && assignUseContext) {
          contextSet.add(node.id.name);
        }

        if (SFCComponent && destructuringUseContext && configuration === 'never') {
          context.report({
            node,
            message: `Must never use destructuring ${node.init.callee.name} assignment`,
          });
        }

        if (SFCComponent && destructuringSFC && configuration === 'never') {
          report(context, messages.noDestructAssignment, 'noDestructAssignment', {
            node,
            data: {
              type: node.init.name,
            },
          });
        }

        if (
          classComponent && destructuringClass && configuration === 'never'
          && !(ignoreClassFields && (node.parent.type === 'ClassProperty' || node.parent.type === 'PropertyDefinition'))
        ) {
          report(context, messages.noDestructAssignment, 'noDestructAssignment', {
            node,
            data: {
              type: node.init.property.name,
            },
          });
        }

        if (
          SFCComponent
          && destructuringSFC
          && configuration === 'always'
          && destructureInSignature === 'always'
          && node.init.name === 'props'
        ) {
          const scopeSetProps = context.getScope().set.get('props');
          const propsRefs = scopeSetProps && scopeSetProps.references;
          if (!propsRefs) {
            return;
          }
          // Skip if props is used elsewhere
          if (propsRefs.length > 1) {
            return;
          }
          report(context, messages.destructureInSignature, 'destructureInSignature', {
            node,
            fix(fixer) {
              const param = SFCComponent.node.params[0];
              if (!param) {
                return;
              }
              const replaceRange = [
                param.range[0],
                param.typeAnnotation ? param.typeAnnotation.range[0] : param.range[1],
              ];
              return [
                fixer.replaceTextRange(replaceRange, context.getSourceCode().getText(node.id)),
                fixer.remove(node.parent),
              ];
            },
          });
        }
      },
    };
  }),
};
