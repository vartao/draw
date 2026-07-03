#!/usr/bin/env node

const { getOperationalStatus } = require('../server');

getOperationalStatus()
  .then((status) => {
    console.log(JSON.stringify(status, null, 2));
    process.exitCode = status.ok ? 0 : 1;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
