import 'mocha';
import { strict as assert } from 'assert';
import * as sbv2 from '../src/sbv2';
import Big from 'big.js';

describe("Decimal tests", () => {

  it('Converts a SwitchboardDecimal to a Big', async () => {
	  let sbd = new sbv2.SwitchboardDecimal(8675309, 3);
	  assert(sbd.toBig().toNumber() == 8675.309);
  });

  it('Converts a Big to a SwitchboardDecimal', async () => {
	  let b = Big(100.25);
	  let sbd = sbv2.SwitchboardDecimal.fromBig(b);
	  assert(sbd.mantissa == 10025);
	  assert(sbd.scale == 2);

	  b = Big(10.025);
	  sbd = sbv2.SwitchboardDecimal.fromBig(b);
	  assert(sbd.mantissa == 10025);
	  assert(sbd.scale == 3);

	  b = Big(.10025);
	  sbd = sbv2.SwitchboardDecimal.fromBig(b);
	  assert(sbd.mantissa == 10025);
	  assert(sbd.scale == 5);

	  b = Big(0);
	  sbd = sbv2.SwitchboardDecimal.fromBig(b);
	  assert(sbd.mantissa == 0);
	  assert(sbd.scale == 0);

	  b = Big(-270.4);
	  sbd = sbv2.SwitchboardDecimal.fromBig(b);
	  assert(sbd.mantissa == -2704);
	  assert(sbd.scale == 1);

  });


});
