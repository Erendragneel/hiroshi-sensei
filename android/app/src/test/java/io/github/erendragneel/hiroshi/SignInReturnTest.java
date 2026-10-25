package io.github.erendragneel.hiroshi;

import static org.junit.Assert.*;
import android.content.Intent;
import android.net.Uri;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=36)
public final class SignInReturnTest {
    @Test public void theReturnLinkOnlyRecognizesTheCredentialFreeAppDestination(){
        assertTrue(MainActivity.isSignInReturn(new Intent(Intent.ACTION_VIEW,Uri.parse("hiroshi-sensei://signin-complete"))));
        assertTrue(MainActivity.isSignInReturn(new Intent(Intent.ACTION_VIEW,Uri.parse("hiroshi-sensei://signin-complete/"))));
        for(String uri:new String[]{"https://signin-complete","hiroshi-sensei://other","hiroshi-sensei://signin-complete/other",
                "hiroshi-sensei://signin-complete?code=not-a-credential","hiroshi-sensei://signin-complete#fragment",
                "hiroshi-sensei://someone@signin-complete","hiroshi-sensei://signin-complete:1234"}){
            assertFalse(MainActivity.isSignInReturn(new Intent(Intent.ACTION_VIEW,Uri.parse(uri))));
        }
        assertFalse(MainActivity.isSignInReturn(new Intent(Intent.ACTION_MAIN,Uri.parse("hiroshi-sensei://signin-complete"))));
        assertFalse(MainActivity.isSignInReturn(null));
    }
}
