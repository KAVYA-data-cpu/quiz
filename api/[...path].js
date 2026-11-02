let app,err;try{app=require('../server')}catch(e){err=e;console.error('startup failed',e)}
module.exports=(q,r)=>{if(err){r.statusCode=500;r.setHeader('Content-Type','application/json');return r.end(JSON.stringify({error:'Startup error. Check TURSO_DATABASE_URL, TURSO_AUTH_TOKEN and SESSION_SECRET in Vercel, then redeploy.'}))}return app(q,r)};
