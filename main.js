#!/user/bin/node
const Common    = require('./common.js');
const Vcs       = require('./vcs.js');
const Files     = require('./file.js');
const Transport = require('./transport.js');

const ArgumentParser = require('argparse').ArgumentParser;
const Path           = require('path');

const parser = new ArgumentParser({
    version: '1.0.4',
    addHelp:true,
    description: 'NPM security plugin'
});
parser.addArgument(
    [ '-t', '--token' ],
    {
        help: 'Token used to identify report provider.'
    }
);
parser.addArgument(
    [ '-o', '--output_path' ],
    {
        help: 'Output file absolute path [optional]'
    }
);
parser.addArgument(
    [ '-p', '--port' ],
    {
        help: 'Port to be used to transport report to reshift (443 by default) [optional]'
    }
);
parser.addArgument(
    [ '-u', '--host' ],
    {
        help: 'Host to be used to transport report to (\'reshift.softwaresecured.com\' by default)  [optional]'
    }
);
const args = parser.parseArgs();


/*
    AUDITSTR   := newType('AUDITSTR', string)
    description : function to execute 'npm audit' if 'package.json' in the dir.
    requires    : None,
    return:     : Optional[AUDITSTR]
*/
function runAudit(root_path){
    var data = Common.systemSync('ls', root_path);
    if (data.includes('package.json')) {
        // if lock not in the package, we need to create one.
        if (! data.includes('package-lock.json')){
            console.log('INFO - Creating locks for dependency checker.');
            Common.systemSync('npm i --package-lock-only', root_path);
        }
        return Common.systemSync('npm audit --json', root_path);
    }
    else{
        console.log('INFO - Unable to locate base package information, are you sure package.json included?');
        return null;
    }
};


/*
    STARTTIME   := newType('STARTTIME', str)
    description : function to create a bundle data
    requires    : data     -> JSON,
                  start    -> STARTTIME
    returns     : JSON
*/
function processResult(data, start, root_path){
    // get host name, parse raw data
    var host_name = Common.systemSync('hostname')
    var raw_data  = JSON.parse(data);

    // walk though root and get all the file name
    var root_json = {};
    Files.walkDir(root_path, root_json);
    var is_git    = Files.isGit(root_json);

    // get info related to git
    var git_hash  = null, proj_name = null, blame_inf = null, git_url = null;
    if (is_git){
        git_hash  = Vcs.getHash(root_path);
        proj_name = Vcs.getProject(root_path);
        blame_inf = Vcs.getBlame(root_path);
        git_url   = Vcs.getURL(root_path);
    }

    // get dependency related, assume package.json at root
    var package   = Files.loadPackage(root_path + '/package.json');
    var dep_lists = Files.getDependencyList(package);
    var blm_lists = Vcs.parseBlm(blame_inf, dep_lists);
    // always ok for now, we need exception handler
    var status    = 0;

    var bundle = {}, date_time = {}, project = {}, project_meta = {}, vcs_info = {};
    bundle['Date']          = date_time;
    date_time['Start']      = start;
    bundle['Machine Name']  = host_name;
    bundle['Project']       = project;
    project['Dependency Report'] = raw_data;
    project['Project Meta']      = project_meta;
    project_meta['Project Name'] = proj_name;
    project_meta['Dependencies'] = dep_lists;
    project_meta['Absolute pth'] = root_path;
    project_meta['Exit Code'] = status;
    project_meta['VCS Info']     = vcs_info;
    project_meta['File Info']    = root_json;
    project_meta['Root']         = '.';
    vcs_info['Git Url']          = git_url;
    vcs_info['Git Hash']         = git_hash;
    vcs_info['blm_lists']        = blm_lists;

    return bundle;
}


/*
    TOKEN      := newType('TOKEN', string)
    CAPNP      := newType('CAPNP', bytes)
    description : main function to run audit, process result and possibly send to server.
    requires    : token  - TOKEN,
                  isSend - Optional[bool]
    return:     : Optional[CAPNP]
*/
function main(token, isSend = true){
    if (args['token'] == null){
        console.log('INFO - System exit since no token provided.');
        console.log('INFO - Use \'-h\' argument to see help.')
        return null;
    }

    var root_path = Files.correctRoot(Files.getCWD());
    console.log("INFO - Verifying npm.")

    var npm_ver  = Common.get_npm(root_path);
    var ver_list = npm_ver.split('.')
    if ((ver_list[0] + ver_list[1]) < 51){
        console.log('INFO - System exit since npm version too low(below 5.2.0), please check your npm (local package will override global one).');
        console.log('INFO - Local npm version:' + npm_ver)
        return null;
    };

    var token = args['token'];
    var start = new Date().getUTCDate();
    var data  = runAudit(root_path);

    console.log("INFO - Creating dependency report.")

    if (data == null){
        console.log('INFO - System exit since no project found.');
        return null;
    };

    result  = processResult(data, start, root_path);

    if (JSON.stringify(result).includes('Not Committed Yet')){
        console.log('INFO - System exit since you have uncommitted contents.');
        return null;
    }

    var end = new Date().getUTCDate();
    result['Date']['End'] = end;

    if (args['output_path'] == null){
        Transport.sendResult(token, result, args['host'], args['port'])
        return null;
    }
    else{
        Files.saveResult(args['output_path'], result)
        return result;
    }
};


main(null, false);