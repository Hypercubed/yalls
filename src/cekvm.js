(function() {

Function.prototype.apply2 = function(self, args, arga, kont) {
    if (!this.extraArgs) this.extraArgs = [ ]
        
    this.extraArgs.push(this.arga)
    this.arga = arga

    var ret = this.apply(self, args)

    this.arga = this.extraArgs.pop()
    return ret
}

/*
 * CEK machine implement
 */

function environment(parent, local) {
    local = local || { }

    // directly access local with 'local'
    local.local = local

    // save env as '@' so that variables can be access with 'local.var'
    local['@'] = function(name, value, setParent) {
        if (arguments.length > 1)
            return !(name in local) && parent && setParent ?
                parent.apply(null, arguments) : (local[name] = value)
        else
            return !(name in local) && parent ? parent(name) : local[name]
    }

    // allow overwritting seek function
    return function() {
        return local['@'].apply(local, arguments)
    }
}

function callenv(lambda, parent, self, args, arga) {
    var env = environment(parent)

    env('self', self)

    env('args', args)
    for (var i = 1; i < lambda.length - 1; i ++)
        env(lambda[i], args[i - 1])

    env('arga', arga || { })
    if (arga) for (var k in arga)
        env(k, arga[k])

    return env
}

function value(exp, env) {
    if (typeof(exp) === 'string')
        return exp.substr(0, 1) === '"' ? exp.substr(1) : env(exp)
    else
        return exp
}

function closure(lambda, parent) {
    var clo = function() {
        var env = callenv(lambda, parent, this, arguments, clo.arga)
        return run(lambda[lambda.length - 1], env)
    }
    clo.yallsClosure = { lambda, parent }
    return clo
}

function continuation(kont) {
    var con = function(value) {
        throw 'RuntimeError: continuation can only be called from interval env'
    }
    con.yallsContinuation = kont
    return con
}

function applyProc(proc, self, paras, kont) {
    var args = [ ], arga = { }
    paras.forEach(e => {
        if (Array.isArray(e) && e[0] === 'name=arg')
            arga[ e[1] ] = e[2]
        else
            args.push(e)
    })

    if (proc && proc.yallsClosure) {
        var { lambda, parent } = proc.yallsClosure,
            env = callenv(lambda, parent, self, args, arga)
        return [lambda[lambda.length - 1], env, kont]
    }
    else if (proc && proc.yallsContinuation) {
        return applyKont(proc.yallsContinuation, args[0])
    }
    else if (typeof(proc) === 'function') {
        return applyKont(kont, proc.apply2(self, args, arga))
    }
    else {
        console.log(proc)
        throw 'RuntimeError: ' + proc + ' is not a function!'
    }
}

function applyKont(kont, value) {
    if (kont) {
        var [name, exp, env, lastKont] = kont
        env = environment(env)
        env(name, value)
        return [exp, env, lastKont]
    }
    else {
        return [value]
    }
}

function step(exp, env, kont) {
    if (!(exp && exp.isStatement))
        return applyKont(kont, value(exp, env))

    var func = stepStmts[ exp[0] ] || stepStmts['apply-function']
    return func(exp, env, kont)
}

var stepStmts = {
    // closure
    'lambda': function(exp, env, kont) {
        return [closure(exp, env), env, kont]
    },
    // let v e1 b
    'let': function(exp, env, kont) {
        return [exp[2], env, [exp[1], exp[3], env, kont]]
    },
    // set v1 a1 v2 a2 ...
    'set': function(exp, env, kont) {
        for (var i = 1, pair = [ ]; i < exp.length; i += 2)
            pair.push(exp[i], value(exp[i + 1], env))
        for (var i = 0, last = undefined; i < pair.length; i += 2)
            last = env(pair[i], pair[i + 1], true)
        return applyKont(kont, last)
    },
    // if a e1 e2
    'if': function(exp, env, kont) {
        return [value(exp[1], env) ? exp[2] : exp[3], env, kont]
    },
    // if a e1 e2
    'begin': function(exp, env, kont) {
        return applyKont(kont, value(exp[exp.length - 1], env))
    },
    // call/cc a
    'callcc': function(exp, env, kont) {
        return applyProc(value(exp[1], env), env('self'), [continuation(kont)], kont)
    },
    // .name-arg name arg
    'named-arg': function(exp, env, kont) {
        return applyKont(kont, ['name=arg', value(exp[1], env), value(exp[2], env)])
    },
    // .apply-method obj method a ...
    'apply-method': function(exp, env, kont) {
        var args = exp.slice(3).map(a => value(a, env))
        return applyProc(value(exp[2], env), value(exp[1], env), args, kont)
    },
    // fn a a ...
    'apply-function': function(exp, env, kont) {
        var args = exp.slice(1).map(a => value(a, env))
        return applyProc(value(exp[0], env), env('self'), args, kont)
    },
}

function stmt(exp) {
    if (!Array.isArray(exp))
        return exp

    exp = exp.map(stmt)
    exp.isStatement = true
    return exp
}

// http://matt.might.net/articles/a-normalization/
function anf(exp) {
    if (!Array.isArray(exp))
        return exp

    var func = anfRules[ exp[0] ] || anfRules['apply-function'],
        wrapper = [ ]

    exp = func(exp, function(exp) {
        var sym = '#a' + (anf.index = (anf.index || 0) + 1)
        wrapper.push([sym, exp])
        return sym
    })

    exp = exp.map(anf)

    wrapper.reverse().forEach(pair => {
        exp = ['let', pair[0], anf(pair[1]), exp]
    })

    return exp
}

var anfRules = {
    // [lambda v ... b] -> [lambda v ... b]
    'lambda': function(exp, wrap) {
        return exp
    },
    // [let v e b] -> [let v e b]
    'let': function(exp, wrap) {
        return exp
    },
    // [set v1 [...] v2 [...]] -> [let #1 [...] [let #2 [...] [set v1 #1 v2 #2]]]
    'set': function(exp, wrap) {
        for (var i = 2; i < exp.length; i += 2)
            if (Array.isArray(exp[i]) || typeof(exp[i]) === 'string')
                exp[i] = wrap(exp[i])
        return exp
    },
    // [if [...] e1 e2] -> [let # [...] [if # e1 e2]]
    'if': function(exp, wrap) {
        if (Array.isArray(exp[1]))
            exp[1] = wrap(exp[1])
        return exp
    },
    // [c c1] -> [let #1 c [let #2 c1 [#1 #2]]]
    'apply-function': function(exp, wrap) {
        if (Array.isArray(exp[0]))
            exp[0] = wrap(exp[0])
        // all the arguments must be wrapped because they may change when evaluating
        for (var i = 1; i < exp.length; i ++)
            if (Array.isArray(exp[i]) || typeof(exp[i]) === 'string')
                exp[i] = wrap(exp[i])
        return exp
    },
}

function run(exp, env, kont) {
    if (!exp.isStatement) {
        exp = anf(exp)
        exp = stmt(exp)
    }

    var state = [exp, env, kont]
    while (state[0] && state[0].isStatement || state[2])
        state = step.apply(undefined, state)
    return state[0]
}

run.environment = environment

if (typeof(module) !== 'undefined')
	module.exports = run
else if (typeof(window) !== 'undefined')
	window.evaluate = run

})()
