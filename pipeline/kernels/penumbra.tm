KPL/MK

   PENUMBRA meta-kernel
   --------------------
   Loads the NASA/JPL NAIF SPICE kernels used by the pipeline.
   Paths are relative to this file's folder: run the pipeline scripts,
   which change into this folder before calling FURNSH.

   naif0012.tls               leap seconds (UTC <-> TDB)
   de440s.bsp                 JPL DE440 planetary ephemeris (short span, 1849-2150)
   moon_pa_de440_200625.bpc   lunar orientation (principal-axes frame, includes libration)
   moon_de440_250416.tf       lunar frames: MOON_PA and MOON_ME (mean Earth / polar axis),
                              the frame LOLA topography is expressed in

\begindata

   KERNELS_TO_LOAD = ( 'naif0012.tls',
                       'de440s.bsp',
                       'moon_pa_de440_200625.bpc',
                       'moon_de440_250416.tf' )

\begintext
