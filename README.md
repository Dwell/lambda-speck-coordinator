# lambda-speck-coordinator

### Generating ECDSA Private and Public Keypairs

```
openssl ecparam -name secp256k1 -out ec-params.pem
openssl ecparam -in ec-params.pem -genkey -noout -out ec-privkey.pem
openssl ec -in ec-privkey.pem -pubout -out ec-pubkey.pem
```